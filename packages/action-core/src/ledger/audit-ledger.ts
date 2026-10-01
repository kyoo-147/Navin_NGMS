import {
  AuditRecordSchema,
  type AuditActor,
  type AuditOutcome,
  type AuditRecord,
  type AuditTarget,
  type RiskTier,
} from '@navin/contracts'

import { nowIso, type Clock } from '../clock.js'
import { ActionCoreError } from '../errors.js'
import { parseJson, stringifyJson } from '../json.js'
import { redact } from '../redaction.js'
import type { SqliteDatabase } from '../sqlite/database.js'
import type { IdFactory } from '../ids.js'
import { assertContract } from '../validation.js'

export interface AppendAuditInput {
  id?: string
  actor: AuditActor
  actionName: string
  target: AuditTarget
  outcome: AuditOutcome
  riskTier: RiskTier
  approvalId?: string
  details?: Record<string, unknown>
  timestamp?: string
}

export interface ListAuditFilter {
  actionName?: string
  outcome?: AuditOutcome
  limit?: number
  offset?: number
}

export interface AuditLedgerDeps {
  ids: IdFactory
  clock: Clock
}

interface AuditRow {
  id: string
  actor: string
  action_name: string
  target: string
  outcome: string
  risk_tier: number
  approval_id: string | null
  details: string | null
  timestamp: string
}

function toRecord(row: AuditRow): AuditRecord {
  const details = parseJson<Record<string, unknown>>(row.details)
  return {
    id: row.id,
    actor: parseJson<AuditActor>(row.actor) as AuditActor,
    actionName: row.action_name,
    target: parseJson<AuditTarget>(row.target) as AuditTarget,
    outcome: row.outcome as AuditOutcome,
    riskTier: row.risk_tier as RiskTier,
    ...(row.approval_id === null ? {} : { approvalId: row.approval_id }),
    ...(details === undefined ? {} : { details }),
    timestamp: row.timestamp,
  }
}

/**
 * Append-only control-plane audit trail. Actor, target and details are redacted
 * before persistence so secrets and raw message bodies never reach the ledger.
 */
export class AuditLedger {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly deps: AuditLedgerDeps,
  ) {}

  append(input: AppendAuditInput): AuditRecord {
    const id = input.id ?? this.deps.ids('aud')
    const timestamp = input.timestamp ?? nowIso(this.deps.clock)

    const record: AuditRecord = {
      id,
      actor: redact(input.actor),
      actionName: input.actionName,
      target: redact(input.target),
      outcome: input.outcome,
      riskTier: input.riskTier,
      ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
      ...(input.details === undefined ? {} : { details: redact(input.details) }),
      timestamp,
    }
    assertContract(AuditRecordSchema, record, 'audit record')

    this.db
      .prepare(
        `INSERT INTO audit_records
           (id, actor, action_name, target, outcome, risk_tier, approval_id, details, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        stringifyJson(record.actor),
        record.actionName,
        stringifyJson(record.target),
        record.outcome,
        record.riskTier,
        record.approvalId ?? null,
        record.details === undefined ? null : stringifyJson(record.details),
        record.timestamp,
      )

    return record
  }

  get(id: string): AuditRecord | undefined {
    const row = this.db.prepare('SELECT * FROM audit_records WHERE id = ?').get(id) as
      AuditRow | undefined
    return row === undefined ? undefined : toRecord(row)
  }

  require(id: string): AuditRecord {
    const record = this.get(id)
    if (record === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Audit record ${id} was not found`, {
        details: { id },
      })
    }
    return record
  }

  list(filter: ListAuditFilter = {}): AuditRecord[] {
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (filter.actionName !== undefined) {
      clauses.push('action_name = ?')
      params.push(filter.actionName)
    }
    if (filter.outcome !== undefined) {
      clauses.push('outcome = ?')
      params.push(filter.outcome)
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const limit = Math.max(1, Math.trunc(filter.limit ?? 200))
    const offset = Math.max(0, Math.trunc(filter.offset ?? 0))
    const rows = this.db
      .prepare(`SELECT * FROM audit_records${where} ORDER BY timestamp ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as AuditRow[]
    return rows.map(toRecord)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM audit_records').get() as {
      total: number | bigint
    }
    return Number(row.total)
  }
}
