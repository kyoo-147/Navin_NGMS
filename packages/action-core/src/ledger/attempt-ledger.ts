import { nowIso, type Clock } from '../clock.js'
import { ActionCoreError } from '../errors.js'
import { redact } from '../redaction.js'
import type { SqliteDatabase } from '../sqlite/database.js'
import type { IdFactory } from '../ids.js'

export type AttemptStatus =
  'reserved' | 'dispatched' | 'succeeded' | 'failed' | 'unknown' | 'aborted'

export interface ActionAttempt {
  id: string
  actionId: string
  attempt: number
  idempotencyKey?: string
  externalIdempotencyKey: string
  status: AttemptStatus
  startedAt: string
  dispatchedAt?: string
  finishedAt?: string
  detail?: string
}

export interface BeginAttemptInput {
  actionId: string
  idempotencyKey?: string
  now: string
}

export interface AttemptLedgerDeps {
  ids: IdFactory
  clock: Clock
}

/** Only terminal outcomes are immutable; an aborted reservation may resume safely,
 * and an unknown outcome may be resolved by a production verifier. */
const ATTEMPT_TRANSITIONS: Readonly<Record<AttemptStatus, readonly AttemptStatus[]>> = {
  reserved: ['dispatched', 'aborted', 'failed'],
  dispatched: ['succeeded', 'failed', 'unknown'],
  aborted: ['dispatched'],
  succeeded: [],
  failed: [],
  unknown: ['succeeded', 'failed'],
}

interface AttemptRow {
  id: string
  action_id: string
  idempotency_key: string | null
  external_idempotency_key: string | null
  status: string
  attempt: number | bigint
  started_at: string
  dispatched_at: string | null
  finished_at: string | null
  detail: string | null
}

export function externalIdempotencyKeyForAction(actionId: string): string {
  return `navin-action:${actionId}`
}

function toAttempt(row: AttemptRow): ActionAttempt {
  const externalKey = externalIdempotencyKeyForAction(row.action_id)
  if (row.external_idempotency_key !== null && row.external_idempotency_key !== externalKey) {
    throw new ActionCoreError(
      'CONFLICT',
      `Attempt ${row.id} has an external idempotency key that does not belong to its action`,
      { details: { attemptId: row.id, actionId: row.action_id } },
    )
  }
  return {
    id: row.id,
    actionId: row.action_id,
    attempt: Number(row.attempt),
    ...(row.idempotency_key === null ? {} : { idempotencyKey: row.idempotency_key }),
    externalIdempotencyKey: externalKey,
    status: row.status as AttemptStatus,
    startedAt: row.started_at,
    ...(row.dispatched_at === null ? {} : { dispatchedAt: row.dispatched_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    ...(row.detail === null ? {} : { detail: row.detail }),
  }
}

/**
 * Durable record of each execution attempt. The reservation is written *before*
 * any external side effect so that a crash after dispatch leaves a `dispatched`
 * row that recovery can flag as an unknown outcome instead of a safe retry.
 */
export class AttemptLedger {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly deps: AttemptLedgerDeps,
  ) {}

  begin(input: BeginAttemptInput): ActionAttempt {
    if (input.idempotencyKey !== undefined) {
      const existing = this.findByIdempotencyKey(input.idempotencyKey)
      if (existing !== undefined) {
        if (existing.actionId !== input.actionId) {
          throw new ActionCoreError(
            'IDEMPOTENCY_CONFLICT',
            `Idempotency key ${input.idempotencyKey} belongs to another action`,
            { details: { key: input.idempotencyKey, actionId: input.actionId } },
          )
        }
        return existing
      }
    }
    const row = this.db
      .prepare(
        'SELECT COALESCE(MAX(attempt), 0) AS max_attempt FROM action_attempts WHERE action_id = ?',
      )
      .get(input.actionId) as { max_attempt: number | bigint }
    const attempt = Number(row.max_attempt) + 1
    const id = this.deps.ids('att')
    const key = input.idempotencyKey ?? null
    const externalKey = externalIdempotencyKeyForAction(input.actionId)
    const detail = 'reserved before dispatch'

    this.db
      .prepare(
        `INSERT INTO action_attempts
           (id, action_id, idempotency_key, external_idempotency_key, status, attempt, started_at, dispatched_at, finished_at, detail)
         VALUES (?, ?, ?, ?, 'reserved', ?, ?, NULL, NULL, ?)`,
      )
      .run(id, input.actionId, key, externalKey, attempt, input.now, detail)

    return {
      id,
      actionId: input.actionId,
      attempt,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      externalIdempotencyKey: externalKey,
      status: 'reserved',
      startedAt: input.now,
      detail,
    }
  }

  get(id: string): ActionAttempt | undefined {
    const row = this.db.prepare('SELECT * FROM action_attempts WHERE id = ?').get(id) as
      AttemptRow | undefined
    return row === undefined ? undefined : toAttempt(row)
  }

  require(id: string): ActionAttempt {
    const attempt = this.get(id)
    if (attempt === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Attempt ${id} was not found`, { details: { id } })
    }
    return attempt
  }

  findByIdempotencyKey(key: string): ActionAttempt | undefined {
    const row = this.db
      .prepare('SELECT * FROM action_attempts WHERE idempotency_key = ?')
      .get(key) as AttemptRow | undefined
    return row === undefined ? undefined : toAttempt(row)
  }

  findByExternalIdempotencyKey(key: string): ActionAttempt | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM action_attempts WHERE external_idempotency_key = ? ORDER BY attempt DESC LIMIT 1',
      )
      .get(key) as AttemptRow | undefined
    return row === undefined ? undefined : toAttempt(row)
  }

  latestForAction(actionId: string): ActionAttempt | undefined {
    const row = this.db
      .prepare('SELECT * FROM action_attempts WHERE action_id = ? ORDER BY attempt DESC LIMIT 1')
      .get(actionId) as AttemptRow | undefined
    return row === undefined ? undefined : toAttempt(row)
  }

  listByAction(actionId: string): ActionAttempt[] {
    const rows = this.db
      .prepare('SELECT * FROM action_attempts WHERE action_id = ? ORDER BY attempt ASC')
      .all(actionId) as unknown as AttemptRow[]
    return rows.map(toAttempt)
  }

  markDispatched(id: string): ActionAttempt {
    return this.transition(id, 'dispatched', {
      detail: 'dispatched to executor',
      dispatchedAt: nowIso(this.deps.clock),
      clearFinishedAt: true,
    })
  }

  succeed(id: string, detail = 'succeeded'): ActionAttempt {
    return this.transition(id, 'succeeded', { detail, finishedAt: nowIso(this.deps.clock) })
  }

  fail(id: string, detail = 'failed'): ActionAttempt {
    return this.transition(id, 'failed', { detail, finishedAt: nowIso(this.deps.clock) })
  }

  markUnknown(id: string, detail = 'outcome unknown after restart'): ActionAttempt {
    return this.transition(id, 'unknown', { detail, finishedAt: nowIso(this.deps.clock) })
  }

  abort(id: string, detail = 'aborted before dispatch'): ActionAttempt {
    return this.transition(id, 'aborted', { detail, finishedAt: nowIso(this.deps.clock) })
  }

  private transition(
    id: string,
    to: AttemptStatus,
    patch: {
      detail: string
      dispatchedAt?: string
      finishedAt?: string
      clearFinishedAt?: boolean
    },
  ): ActionAttempt {
    const current = this.require(id)
    if (current.status !== to && !ATTEMPT_TRANSITIONS[current.status].includes(to)) {
      throw new ActionCoreError(
        'CONFLICT',
        `Illegal attempt transition: ${current.status} -> ${to}`,
        { details: { id, from: current.status, to } },
      )
    }
    this.db
      .prepare(
        `UPDATE action_attempts SET
           status = ?,
           dispatched_at = COALESCE(?, dispatched_at),
           finished_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, finished_at) END,
           detail = ?
         WHERE id = ?`,
      )
      .run(
        to,
        patch.dispatchedAt ?? null,
        patch.clearFinishedAt === true ? 1 : 0,
        patch.finishedAt ?? null,
        redact(patch.detail),
        id,
      )
    return this.require(id)
  }
}
