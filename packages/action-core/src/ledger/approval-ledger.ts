import {
  ApprovalRequestSchema,
  ApprovalDecisionSchema,
  type ApprovalDecision,
  type ApprovalDecisionChoice,
  type ApprovalRequest,
  type ApprovalStatus,
  type ConfirmationType,
  type RiskTier,
} from '@navin/contracts'

import { isExpired, type Clock } from '../clock.js'
import { ActionCoreError } from '../errors.js'
import { parseJson, stringifyJson } from '../json.js'
import {
  assertConfirmationMatchesRisk,
  confirmationTypeForRisk,
  requiresRecentAuthForRisk,
} from '../policy/risk-policy.js'
import type { SqliteDatabase } from '../sqlite/database.js'
import type { IdFactory } from '../ids.js'
import { assertContract } from '../validation.js'

const DEFAULT_TTL_MS = 15 * 60 * 1000

export interface CreateApprovalInput {
  id?: string
  actionId: string
  planId: string
  riskTier: RiskTier
  confirmationType?: ConfirmationType
  typedPhrase?: string
  requestedBy: string
  ttlMs?: number
}

export interface DecideApprovalInput {
  decidedBy: string
  decision: ApprovalDecisionChoice
  reason?: string
  stepUpVerified?: boolean
}

export interface ApprovalLedgerDeps {
  ids: IdFactory
  clock: Clock
}

interface ApprovalRow {
  id: string
  action_id: string
  plan_id: string
  risk_tier: number
  confirmation_type: string
  typed_phrase: string | null
  requires_recent_auth: number
  requested_by: string
  status: string
  decision: string | null
  created_at: string
  expires_at: string
}

function toApproval(row: ApprovalRow): ApprovalRequest {
  const decision = parseJson<ApprovalDecision>(row.decision)
  return {
    id: row.id,
    actionId: row.action_id,
    planId: row.plan_id,
    riskTier: row.risk_tier as RiskTier,
    confirmationType: row.confirmation_type as ConfirmationType,
    ...(row.typed_phrase === null ? {} : { typedPhrase: row.typed_phrase }),
    requiresRecentAuth: row.requires_recent_auth === 1,
    requestedBy: row.requested_by,
    status: row.status as ApprovalStatus,
    ...(decision === undefined ? {} : { decision }),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  } as ApprovalRequest
}

/**
 * Persists risk/approval records. Tier 3 approvals require typed confirmation
 * and recent authentication; those invariants are enforced on create and decide.
 */
export class ApprovalLedger {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly deps: ApprovalLedgerDeps,
  ) {}

  create(input: CreateApprovalInput): ApprovalRequest {
    const confirmationType = input.confirmationType ?? confirmationTypeForRisk(input.riskTier)
    assertConfirmationMatchesRisk(input.riskTier, confirmationType)

    if (input.riskTier === 3) {
      if (input.typedPhrase === undefined || input.typedPhrase.length === 0) {
        throw new ActionCoreError(
          'VALIDATION_FAILED',
          'Tier 3 approvals require a typed confirmation phrase',
        )
      }
    }

    const now = this.deps.clock()
    const id = input.id ?? this.deps.ids('app')
    const approval: ApprovalRequest = {
      id,
      actionId: input.actionId,
      planId: input.planId,
      riskTier: input.riskTier,
      confirmationType,
      ...(input.typedPhrase === undefined ? {} : { typedPhrase: input.typedPhrase }),
      requiresRecentAuth: requiresRecentAuthForRisk(input.riskTier),
      requestedBy: input.requestedBy,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    } as ApprovalRequest
    assertContract(ApprovalRequestSchema, approval, 'approval request')

    this.db
      .prepare(
        `INSERT INTO approvals
           (id, action_id, plan_id, risk_tier, confirmation_type, typed_phrase,
            requires_recent_auth, requested_by, status, decision, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        approval.id,
        approval.actionId,
        approval.planId,
        approval.riskTier,
        approval.confirmationType,
        approval.typedPhrase ?? null,
        approval.requiresRecentAuth ? 1 : 0,
        approval.requestedBy,
        approval.status,
        approval.createdAt,
        approval.expiresAt,
      )

    return approval
  }

  get(id: string): ApprovalRequest | undefined {
    const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as
      ApprovalRow | undefined
    return row === undefined ? undefined : toApproval(row)
  }

  require(id: string): ApprovalRequest {
    const approval = this.get(id)
    if (approval === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Approval ${id} was not found`, { details: { id } })
    }
    return approval
  }

  listByAction(actionId: string): ApprovalRequest[] {
    const rows = this.db
      .prepare('SELECT * FROM approvals WHERE action_id = ? ORDER BY created_at ASC')
      .all(actionId) as unknown as ApprovalRow[]
    return rows.map(toApproval)
  }

  decide(id: string, input: DecideApprovalInput): ApprovalRequest {
    const current = this.require(id)
    if (current.status !== 'pending') {
      throw new ActionCoreError('CONFLICT', `Approval ${id} is already ${current.status}`, {
        details: { id, status: current.status },
      })
    }

    const now = this.deps.clock()
    if (isExpired(current.expiresAt, now)) {
      this.expire(id)
      throw new ActionCoreError('APPROVAL_REQUIRED', `Approval ${id} has expired`, {
        details: { id, expiresAt: current.expiresAt },
      })
    }

    const stepUpVerified = input.stepUpVerified ?? false
    if (current.riskTier === 3 && input.decision === 'approved' && !stepUpVerified) {
      throw new ActionCoreError(
        'RISK_STEP_UP_REQUIRED',
        'Tier 3 approval requires recent authentication (step-up)',
        { details: { id } },
      )
    }

    const decision: ApprovalDecision = {
      approvalId: id,
      decidedBy: input.decidedBy,
      decision: input.decision,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      stepUpVerified,
      decidedAt: now.toISOString(),
    }
    assertContract(ApprovalDecisionSchema, decision, 'approval decision')

    const result = this.db
      .prepare(`UPDATE approvals SET status = ?, decision = ? WHERE id = ? AND status = 'pending'`)
      .run(input.decision, stringifyJson(decision), id)

    if (Number(result.changes) === 0) {
      throw new ActionCoreError('CONFLICT', `Approval ${id} changed concurrently`, {
        details: { id },
      })
    }

    return this.require(id)
  }

  expire(id: string): ApprovalRequest {
    const current = this.require(id)
    if (current.status === 'pending') {
      this.db.prepare(`UPDATE approvals SET status = 'expired' WHERE id = ?`).run(id)
    }
    return this.require(id)
  }
}
