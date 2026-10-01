import { ActionService } from './action-service.js'
import { JobRunner } from './job-runner.js'
import { nowIso, systemClock, type Clock } from './clock.js'
import { createId, type IdFactory } from './ids.js'
import { ActionLedger } from './ledger/action-ledger.js'
import { ApprovalLedger } from './ledger/approval-ledger.js'
import { AttemptLedger } from './ledger/attempt-ledger.js'
import { AuditLedger } from './ledger/audit-ledger.js'
import { EventLog } from './ledger/event-log.js'
import { EvidenceLedger } from './ledger/evidence-ledger.js'
import { IdempotencyStore } from './ledger/idempotency-store.js'
import { JobLedger } from './ledger/job-ledger.js'
import { ExecutorRegistry } from './executor/registry.js'
import { EventStream } from './sse/event-stream.js'
import { SqliteDatabase } from './sqlite/database.js'
import { LATEST_SCHEMA_VERSION, runMigrations } from './sqlite/migrations.js'

export interface ActionCoreOptions {
  /** SQLite database path, or `:memory:` for ephemeral use. */
  path: string
  wal?: boolean
  busyTimeoutMs?: number
  clock?: Clock
  ids?: IdFactory
}

export interface ActionCoreDescription {
  path: string
  journalMode: string
  schemaVersion: number
  latestSchemaVersion: number
  open: boolean
}

/**
 * Single entry point wiring the durable action/job/event/evidence ledger.
 *
 * Everything is persisted in one SQLite WAL database. `navind` opens one
 * instance; surfaces talk to it through the services rather than touching SQL.
 */
export class ActionCore {
  readonly db: SqliteDatabase
  readonly clock: Clock
  readonly ids: IdFactory
  readonly schemaVersion: number
  readonly actions: ActionLedger
  readonly approvals: ApprovalLedger
  readonly attempts: AttemptLedger
  readonly jobs: JobLedger
  readonly events: EventLog
  readonly evidence: EvidenceLedger
  readonly audit: AuditLedger
  readonly idempotency: IdempotencyStore
  readonly executors: ExecutorRegistry
  readonly actionService: ActionService
  readonly jobRunner: JobRunner
  readonly eventStream: EventStream

  private constructor(db: SqliteDatabase, clock: Clock, ids: IdFactory, schemaVersion: number) {
    this.db = db
    this.clock = clock
    this.ids = ids
    this.schemaVersion = schemaVersion

    this.idempotency = new IdempotencyStore(db)
    this.actions = new ActionLedger(db, { ids, clock })
    this.approvals = new ApprovalLedger(db, { ids, clock })
    this.attempts = new AttemptLedger(db, { ids, clock })
    this.jobs = new JobLedger(db, { ids, clock })
    this.events = new EventLog(db, { ids, clock })
    this.evidence = new EvidenceLedger(db, { ids, clock })
    this.audit = new AuditLedger(db, { ids, clock })
    this.executors = new ExecutorRegistry()

    const serviceDeps = {
      db,
      ids,
      clock,
      actions: this.actions,
      approvals: this.approvals,
      attempts: this.attempts,
      events: this.events,
      evidence: this.evidence,
      audit: this.audit,
      idempotency: this.idempotency,
      executors: this.executors,
    }
    this.actionService = new ActionService(serviceDeps)
    this.jobRunner = new JobRunner({ ...serviceDeps, jobs: this.jobs })
    this.eventStream = new EventStream(this.events)
  }

  static open(options: ActionCoreOptions): ActionCore {
    const clock = options.clock ?? systemClock
    const ids = options.ids ?? createId
    const db = SqliteDatabase.open({
      path: options.path,
      wal: options.wal,
      busyTimeoutMs: options.busyTimeoutMs,
    })
    let schemaVersion: number
    try {
      schemaVersion = runMigrations(db, () => nowIso(clock))
    } catch (error) {
      // Do not leak the connection when a migration is unknown or drifted.
      db.close()
      throw error
    }
    return new ActionCore(db, clock, ids, schemaVersion)
  }

  describe(): ActionCoreDescription {
    return {
      path: this.db.path,
      journalMode: this.db.journalMode,
      schemaVersion: this.schemaVersion,
      latestSchemaVersion: LATEST_SCHEMA_VERSION,
      open: this.db.isOpen,
    }
  }

  checkpoint(): void {
    this.db.checkpoint()
  }

  close(): void {
    this.db.close()
  }
}
