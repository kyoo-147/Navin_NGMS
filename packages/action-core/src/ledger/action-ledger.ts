import {
  ActionExecutionSchema,
  type ActionDiff,
  type ActionExecution,
  type ActionLifecycleStage,
  type ActionStatus,
  type ActionVerification,
  type NavinError,
  type NavinSurface,
  type RiskTier,
} from '@navin/contracts'

import { nowIso, type Clock } from '../clock.js'
import { ActionCoreError } from '../errors.js'
import { parseJson, stringifyJson } from '../json.js'
import { redact } from '../redaction.js'
import {
  assertStageForStatus,
  assertTransition,
  canonicalStageForStatus,
} from '../state-machine.js'
import type { SqliteDatabase } from '../sqlite/database.js'
import type { IdFactory } from '../ids.js'
import { assertContract } from '../validation.js'

export interface CreateActionInput {
  id?: string
  name: string
  surface: NavinSurface
  riskTier: RiskTier
  parameters?: Record<string, unknown>
  requestedBy: string
  canRollback?: boolean
  planId?: string
  stage?: ActionLifecycleStage
  status?: ActionStatus
  diff?: ActionDiff
  verification?: ActionVerification
  approvalId?: string
}

export interface UpdateActionInput {
  status?: ActionStatus
  stage?: ActionLifecycleStage
  diff?: ActionDiff
  verification?: ActionVerification
  parameters?: Record<string, unknown>
  canRollback?: boolean
  approvalId?: string
  error?: NavinError | null
  planId?: string
}

export interface ListActionFilter {
  status?: ActionStatus
  statuses?: ActionStatus[]
  name?: string
  surface?: NavinSurface
  requestedBy?: string
  limit?: number
  offset?: number
}

export interface ActionLedgerDeps {
  ids: IdFactory
  clock: Clock
}

interface ActionRow {
  id: string
  name: string
  surface: string
  plan_id: string | null
  stage: string
  status: string
  risk_tier: number
  parameters: string
  diff: string | null
  verification: string | null
  can_rollback: number
  requested_by: string
  approval_id: string | null
  error: string | null
  created_at: string
  updated_at: string
  revision: number
}

function toExecution(row: ActionRow): ActionExecution {
  const diff = parseJson<ActionDiff>(row.diff)
  const verification = parseJson<ActionVerification>(row.verification)
  const error = parseJson<NavinError>(row.error)
  return {
    id: row.id,
    name: row.name,
    surface: row.surface as NavinSurface,
    stage: row.stage as ActionLifecycleStage,
    status: row.status as ActionStatus,
    riskTier: row.risk_tier as RiskTier,
    parameters: parseJson<Record<string, unknown>>(row.parameters) ?? {},
    ...(diff === undefined ? {} : { diff }),
    ...(verification === undefined ? {} : { verification }),
    canRollback: row.can_rollback === 1,
    requestedBy: row.requested_by,
    ...(row.approval_id === null ? {} : { approvalId: row.approval_id }),
    ...(error === undefined ? {} : { error }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as ActionExecution
}

/**
 * Durable action records with a full state machine and optimistic concurrency.
 * Parameters, diffs and errors are redacted before persistence.
 */
export class ActionLedger {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly deps: ActionLedgerDeps,
  ) {}

  create(input: CreateActionInput): ActionExecution {
    const id = input.id ?? this.deps.ids('act')
    const status = input.status ?? 'staged'
    const stage = input.stage ?? canonicalStageForStatus(status)
    assertStageForStatus(status, stage)

    const now = nowIso(this.deps.clock)
    const record: ActionExecution = {
      id,
      name: input.name,
      surface: input.surface,
      stage,
      status,
      riskTier: input.riskTier,
      parameters: redact(input.parameters ?? {}),
      ...(input.diff === undefined ? {} : { diff: redact(input.diff) }),
      ...(input.verification === undefined ? {} : { verification: redact(input.verification) }),
      canRollback: input.canRollback ?? false,
      requestedBy: input.requestedBy,
      ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
      createdAt: now,
      updatedAt: now,
    } as ActionExecution
    assertContract(ActionExecutionSchema, record, 'action execution')

    this.db
      .prepare(
        `INSERT INTO actions
           (id, name, surface, plan_id, stage, status, risk_tier, parameters, diff, verification,
            can_rollback, requested_by, approval_id, error, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1)`,
      )
      .run(
        record.id,
        record.name,
        record.surface,
        input.planId ?? null,
        record.stage,
        record.status,
        record.riskTier,
        stringifyJson(record.parameters),
        record.diff === undefined ? null : stringifyJson(record.diff),
        record.verification === undefined ? null : stringifyJson(record.verification),
        record.canRollback ? 1 : 0,
        record.requestedBy,
        record.approvalId ?? null,
        record.createdAt,
        record.updatedAt,
      )

    return record
  }

  get(id: string): ActionExecution | undefined {
    const row = this.db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as
      ActionRow | undefined
    return row === undefined ? undefined : toExecution(row)
  }

  require(id: string): ActionExecution {
    const action = this.get(id)
    if (action === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Action ${id} was not found`, { details: { id } })
    }
    return action
  }

  getRevision(id: string): number {
    const row = this.db.prepare('SELECT revision FROM actions WHERE id = ?').get(id) as
      { revision: number | bigint } | undefined
    if (row === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Action ${id} was not found`, { details: { id } })
    }
    return Number(row.revision)
  }

  getPlanId(id: string): string | undefined {
    const row = this.db.prepare('SELECT plan_id FROM actions WHERE id = ?').get(id) as
      { plan_id: string | null } | undefined
    if (row === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Action ${id} was not found`, { details: { id } })
    }
    return row.plan_id ?? undefined
  }

  list(filter: ListActionFilter = {}): ActionExecution[] {
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      params.push(filter.status)
    }
    if (filter.statuses !== undefined && filter.statuses.length > 0) {
      clauses.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`)
      params.push(...filter.statuses)
    }
    if (filter.name !== undefined) {
      clauses.push('name = ?')
      params.push(filter.name)
    }
    if (filter.surface !== undefined) {
      clauses.push('surface = ?')
      params.push(filter.surface)
    }
    if (filter.requestedBy !== undefined) {
      clauses.push('requested_by = ?')
      params.push(filter.requestedBy)
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const limit = Math.max(1, Math.trunc(filter.limit ?? 200))
    const offset = Math.max(0, Math.trunc(filter.offset ?? 0))
    const rows = this.db
      .prepare(`SELECT * FROM actions${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as ActionRow[]
    return rows.map(toExecution)
  }

  /**
   * Applies a patch using compare-and-swap on `revision`. When `expectedRevision`
   * is omitted the current revision is read first, giving last-write-wins semantics
   * for callers that do not opt into concurrency control.
   */
  update(id: string, patch: UpdateActionInput, expectedRevision?: number): ActionExecution {
    const row = this.db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as
      ActionRow | undefined
    if (row === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Action ${id} was not found`, { details: { id } })
    }
    const current = toExecution(row)
    const revision = expectedRevision ?? Number(row.revision)

    if (patch.status !== undefined && patch.status !== current.status) {
      assertTransition(current.status, patch.status)
    }

    const nextStatus = patch.status ?? current.status
    const requestedStage =
      patch.stage ??
      (patch.status === undefined
        ? current.stage
        : patch.status === 'failed'
          ? current.stage
          : canonicalStageForStatus(nextStatus))
    assertStageForStatus(nextStatus, requestedStage)

    const next: ActionExecution = {
      ...current,
      status: nextStatus,
      stage: requestedStage,
      parameters: patch.parameters === undefined ? current.parameters : redact(patch.parameters),
      canRollback: patch.canRollback ?? current.canRollback,
      updatedAt: nowIso(this.deps.clock),
      ...(patch.diff !== undefined ? { diff: redact(patch.diff) } : {}),
      ...(patch.verification !== undefined ? { verification: redact(patch.verification) } : {}),
      ...(patch.approvalId !== undefined ? { approvalId: patch.approvalId } : {}),
    } as ActionExecution

    if (patch.error === null) {
      delete next.error
    } else if (patch.error !== undefined) {
      next.error = redact(patch.error)
    }
    assertContract(ActionExecutionSchema, next, 'action execution')

    const result = this.db
      .prepare(
        `UPDATE actions SET
           stage = ?, status = ?, parameters = ?, diff = ?, verification = ?,
           can_rollback = ?, approval_id = ?, error = ?, plan_id = ?, updated_at = ?,
           revision = revision + 1
         WHERE id = ? AND revision = ?`,
      )
      .run(
        next.stage,
        next.status,
        stringifyJson(next.parameters),
        next.diff === undefined ? null : stringifyJson(next.diff),
        next.verification === undefined ? null : stringifyJson(next.verification),
        next.canRollback ? 1 : 0,
        next.approvalId ?? null,
        next.error === undefined ? null : stringifyJson(next.error),
        patch.planId ?? row.plan_id ?? null,
        next.updatedAt,
        id,
        revision,
      )

    if (Number(result.changes) === 0) {
      throw new ActionCoreError(
        'CONFLICT',
        `Action ${id} was modified concurrently (expected revision ${revision})`,
        { details: { id, expectedRevision: revision } },
      )
    }

    return this.require(id)
  }

  /** Convenience wrapper that asserts an allowed status transition. */
  transition(
    id: string,
    toStatus: ActionStatus,
    patch: Omit<UpdateActionInput, 'status'> = {},
    expectedRevision?: number,
  ): ActionExecution {
    return this.update(id, { ...patch, status: toStatus }, expectedRevision)
  }
}
