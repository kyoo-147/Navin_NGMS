import {
  JobSchema,
  type Job,
  type JobProgress,
  type JobStatus,
  type NavinError,
  type NavinSurface,
} from '@navin/contracts'

import { nowIso, type Clock } from '../clock.js'
import { ActionCoreError } from '../errors.js'
import { parseJson, stringifyJson } from '../json.js'
import { redact } from '../redaction.js'
import type { SqliteDatabase } from '../sqlite/database.js'
import type { IdFactory } from '../ids.js'
import { assertContract } from '../validation.js'

export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ['running', 'cancelled', 'failed', 'interrupted'],
  running: ['completed', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: ['running'],
  cancelled: [],
  interrupted: ['running', 'failed', 'cancelled'],
}

export interface CreateJobInput {
  id?: string
  name: string
  surface: NavinSurface
  payload?: Record<string, unknown>
  cancellable?: boolean
  resumable?: boolean
  idempotencyKey?: string
}

export interface UpdateJobInput {
  status?: JobStatus
  progress?: JobProgress
  result?: Record<string, unknown> | null
  error?: NavinError | null
}

export interface ListJobFilter {
  status?: JobStatus
  name?: string
  surface?: NavinSurface
  limit?: number
  offset?: number
}

export interface JobLedgerDeps {
  ids: IdFactory
  clock: Clock
}

interface JobRow {
  id: string
  name: string
  surface: string
  status: string
  idempotency_key: string | null
  cancellable: number
  resumable: number
  progress: string | null
  payload: string
  result: string | null
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  revision: number
}

function toJob(row: JobRow): Job {
  const progress = parseJson<JobProgress>(row.progress)
  const result = parseJson<Record<string, unknown>>(row.result)
  const error = parseJson<NavinError>(row.error)
  return {
    id: row.id,
    name: row.name,
    surface: row.surface as NavinSurface,
    status: row.status as JobStatus,
    ...(row.idempotency_key === null ? {} : { idempotencyKey: row.idempotency_key }),
    cancellable: row.cancellable === 1,
    resumable: row.resumable === 1,
    ...(progress === undefined ? {} : { progress }),
    payload: parseJson<Record<string, unknown>>(row.payload) ?? {},
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error }),
    createdAt: row.created_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  }
}

/**
 * Durable job records. Job payloads, results and progress are redacted before
 * persistence. Status transitions follow JOB_TRANSITIONS.
 */
export class JobLedger {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly deps: JobLedgerDeps,
  ) {}

  create(input: CreateJobInput): Job {
    const id = input.id ?? this.deps.ids('job')
    const job: Job = {
      id,
      name: input.name,
      surface: input.surface,
      status: 'queued',
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      cancellable: input.cancellable ?? true,
      resumable: input.resumable ?? false,
      payload: redact(input.payload ?? {}),
      createdAt: nowIso(this.deps.clock),
    }
    assertContract(JobSchema, job, 'job')

    this.db
      .prepare(
        `INSERT INTO jobs
           (id, name, surface, status, idempotency_key, cancellable, resumable, progress, payload,
            result, error, created_at, started_at, completed_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, NULL, NULL, 1)`,
      )
      .run(
        job.id,
        job.name,
        job.surface,
        job.status,
        job.idempotencyKey ?? null,
        job.cancellable ? 1 : 0,
        job.resumable ? 1 : 0,
        stringifyJson(job.payload),
        job.createdAt,
      )

    return job
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
    return row === undefined ? undefined : toJob(row)
  }

  require(id: string): Job {
    const job = this.get(id)
    if (job === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Job ${id} was not found`, { details: { id } })
    }
    return job
  }

  findByIdempotencyKey(key: string): Job | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(key) as
      JobRow | undefined
    return row === undefined ? undefined : toJob(row)
  }

  getRevision(id: string): number {
    const row = this.db.prepare('SELECT revision FROM jobs WHERE id = ?').get(id) as
      { revision: number | bigint } | undefined
    if (row === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Job ${id} was not found`, { details: { id } })
    }
    return Number(row.revision)
  }

  list(filter: ListJobFilter = {}): Job[] {
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      params.push(filter.status)
    }
    if (filter.name !== undefined) {
      clauses.push('name = ?')
      params.push(filter.name)
    }
    if (filter.surface !== undefined) {
      clauses.push('surface = ?')
      params.push(filter.surface)
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const limit = Math.max(1, Math.trunc(filter.limit ?? 200))
    const offset = Math.max(0, Math.trunc(filter.offset ?? 0))
    const rows = this.db
      .prepare(`SELECT * FROM jobs${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as JobRow[]
    return rows.map(toJob)
  }

  update(id: string, patch: UpdateJobInput, expectedRevision?: number): Job {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
    if (row === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Job ${id} was not found`, { details: { id } })
    }
    const current = toJob(row)
    const revision = expectedRevision ?? Number(row.revision)

    if (patch.status !== undefined && patch.status !== current.status) {
      if (!JOB_TRANSITIONS[current.status].includes(patch.status)) {
        throw new ActionCoreError(
          'CONFLICT',
          `Illegal job transition: ${current.status} -> ${patch.status}`,
          { details: { from: current.status, to: patch.status } },
        )
      }
    }

    const now = nowIso(this.deps.clock)
    const status = patch.status ?? current.status
    const next: Job = {
      ...current,
      status,
      ...(patch.progress === undefined ? {} : { progress: redact(patch.progress) }),
    }

    if (patch.result === null) {
      delete next.result
    } else if (patch.result !== undefined) {
      next.result = redact(patch.result)
    }
    if (patch.error === null) {
      delete next.error
    } else if (patch.error !== undefined) {
      next.error = redact(patch.error)
    }

    if (patch.status === 'running' && current.startedAt === undefined) {
      next.startedAt = now
    }
    if (
      (status === 'completed' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'interrupted') &&
      patch.status !== undefined
    ) {
      next.completedAt = now
    }
    assertContract(JobSchema, next, 'job')

    const result = this.db
      .prepare(
        `UPDATE jobs SET
           status = ?, progress = ?, result = ?, error = ?, started_at = ?, completed_at = ?,
           revision = revision + 1
         WHERE id = ? AND revision = ?`,
      )
      .run(
        next.status,
        next.progress === undefined ? null : stringifyJson(next.progress),
        next.result === undefined ? null : stringifyJson(next.result),
        next.error === undefined ? null : stringifyJson(next.error),
        next.startedAt ?? null,
        next.completedAt ?? null,
        id,
        revision,
      )

    if (Number(result.changes) === 0) {
      throw new ActionCoreError(
        'CONFLICT',
        `Job ${id} was modified concurrently (expected revision ${revision})`,
        { details: { id, expectedRevision: revision } },
      )
    }

    return this.require(id)
  }
}
