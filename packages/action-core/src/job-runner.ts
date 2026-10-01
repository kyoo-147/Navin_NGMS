import type { AuditActor, Job, JobProgress, NavinSurface } from '@navin/contracts'

import { type Clock } from './clock.js'
import { ActionCoreError, toNavinError } from './errors.js'
import type { IdFactory } from './ids.js'
import type { AuditLedger } from './ledger/audit-ledger.js'
import type { EventLog } from './ledger/event-log.js'
import type { IdempotencyStore } from './ledger/idempotency-store.js'
import type { JobLedger } from './ledger/job-ledger.js'
import type { SqliteDatabase } from './sqlite/database.js'
import type { ExecutorRegistry } from './executor/registry.js'
import type { JobHandlerPort } from './executor/ports.js'

const JOB_CHANNEL = 'jobs' as const

export interface JobRunnerDeps {
  db: SqliteDatabase
  ids: IdFactory
  clock: Clock
  jobs: JobLedger
  events: EventLog
  audit: AuditLedger
  idempotency: IdempotencyStore
  executors: ExecutorRegistry
}

export interface StageJobInput {
  name: string
  surface: NavinSurface
  payload?: Record<string, unknown>
  cancellable?: boolean
  resumable?: boolean
  idempotencyKey?: string
}

export interface RunJobInput {
  handler?: JobHandlerPort
  actor?: AuditActor
  signal?: AbortSignal
}

/**
 * Durable job execution. Progress is streamed as events on the `jobs` channel and
 * persisted so clients can resume by job id after a reconnect or restart.
 */
export class JobRunner {
  private readonly inFlight = new Set<string>()

  constructor(private readonly deps: JobRunnerDeps) {}

  createJob(input: StageJobInput): Job {
    const { db, ids, clock, jobs, idempotency } = this.deps
    const jobId = ids('job')
    const now = clock().toISOString()

    return db.transaction(() => {
      if (input.idempotencyKey !== undefined) {
        const reservation = idempotency.reserve({
          scope: 'job:create',
          key: input.idempotencyKey,
          requestHash: idempotency.hashRequest({
            name: input.name,
            surface: input.surface,
            payload: input.payload ?? {},
          }),
          resourceType: 'job',
          resourceId: jobId,
          now,
        })
        if (reservation.idempotent) {
          return jobs.require(reservation.record.resourceId)
        }
      }
      return jobs.create({
        id: jobId,
        name: input.name,
        surface: input.surface,
        payload: input.payload,
        cancellable: input.cancellable,
        resumable: input.resumable,
        idempotencyKey: input.idempotencyKey,
      })
    })
  }

  getJob(id: string): Job {
    return this.deps.jobs.require(id)
  }

  listJobs(filter?: Parameters<JobLedger['list']>[0]): Job[] {
    return this.deps.jobs.list(filter)
  }

  async run(jobId: string, input: RunJobInput = {}): Promise<Job> {
    const { db, jobs, events, executors } = this.deps
    const job = jobs.require(jobId)
    if (this.inFlight.has(jobId)) {
      throw new ActionCoreError('CONFLICT', `Job ${jobId} is already running`, {
        details: { jobId },
      })
    }
    const handler = input.handler ?? executors.requireJobHandler(job.name)
    this.inFlight.add(jobId)

    try {
      db.transaction(() => {
        jobs.update(jobId, { status: 'running' })
        events.append({ kind: 'job.running', channel: JOB_CHANNEL, jobId, status: 'running' })
      })

      const reportProgress = (progress: JobProgress): void => {
        db.transaction(() => {
          jobs.update(jobId, { progress })
          events.append({
            kind: 'job.progress',
            channel: JOB_CHANNEL,
            jobId,
            status: 'running',
            progress,
          })
        })
      }
      const emitEvent = (payload: { kind: string; data?: Record<string, unknown> }): void => {
        events.append({
          kind: payload.kind,
          channel: JOB_CHANNEL,
          jobId,
          status: 'running',
          data: payload.data,
        })
      }

      const result = await handler.run(job, {
        jobId,
        signal: input.signal,
        reportProgress,
        emitEvent,
      })

      return db.transaction(() => {
        const completed = jobs.update(jobId, { status: 'completed', result: result ?? {} })
        events.append({ kind: 'job.completed', channel: JOB_CHANNEL, jobId, status: 'completed' })
        this.recordAudit(completed, 'success', input.actor)
        return completed
      })
    } catch (error) {
      const navinError = toNavinError(error, job.surface)
      try {
        db.transaction(() => {
          const failed = jobs.update(jobId, { status: 'failed', error: navinError })
          events.append({
            kind: 'job.failed',
            channel: JOB_CHANNEL,
            jobId,
            status: 'failed',
            data: { message: navinError.message },
          })
          this.recordAudit(failed, 'failure', input.actor)
        })
      } catch {
        // Preserve the original error if the failure record cannot be written.
      }
      throw error
    } finally {
      this.inFlight.delete(jobId)
    }
  }

  cancel(jobId: string, input: { actor?: AuditActor } = {}): Job {
    const { db, jobs, events } = this.deps
    const job = jobs.require(jobId)
    if (!job.cancellable) {
      throw new ActionCoreError('ACTION_BLOCKED', `Job ${jobId} is not cancellable`, {
        details: { jobId },
      })
    }
    return db.transaction(() => {
      const cancelled = jobs.update(jobId, { status: 'cancelled' })
      events.append({ kind: 'job.cancelled', channel: JOB_CHANNEL, jobId, status: 'cancelled' })
      this.recordAudit(cancelled, 'denied', input.actor)
      return cancelled
    })
  }

  /** Marks jobs left `running` by a previous process as interrupted (resumable). */
  recoverInterrupted(actor?: AuditActor): Job[] {
    const { db, jobs, events } = this.deps
    const running = jobs.list({ status: 'running', limit: 1000 })
    return db.transaction(() =>
      running.map((job) => {
        const interrupted = jobs.update(job.id, { status: 'interrupted' })
        events.append({
          kind: 'job.interrupted',
          channel: JOB_CHANNEL,
          jobId: job.id,
          status: 'interrupted',
        })
        this.recordAudit(interrupted, 'failure', actor)
        return interrupted
      }),
    )
  }

  private recordAudit(
    job: Job,
    outcome: 'success' | 'failure' | 'denied',
    actor?: AuditActor,
  ): void {
    this.deps.audit.append({
      actor: actor ?? { userId: 'usr_system', role: 'ops.operator', surface: job.surface },
      actionName: `job.${job.name}`,
      target: { jobId: job.id, resourceType: 'job' },
      outcome,
      riskTier: 1,
      details: { status: job.status },
    })
  }
}
