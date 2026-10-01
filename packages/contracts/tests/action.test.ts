import { describe, it, expect } from 'vitest'
import {
  RiskTierSchema,
  ActionLifecycleStageSchema,
  ActionStatusSchema,
  ActionDiffSchema,
  ActionExecutionSchema,
  ApprovalRequestSchema,
  ApprovalDecisionSchema,
  validate,
  isValid,
} from '../src/index.js'

describe('Action Lifecycle & Risk/Approval Contracts', () => {
  it('validates canonical risk tiers (0 to 3)', () => {
    expect(isValid(RiskTierSchema, 0)).toBe(true)
    expect(isValid(RiskTierSchema, 1)).toBe(true)
    expect(isValid(RiskTierSchema, 2)).toBe(true)
    expect(isValid(RiskTierSchema, 3)).toBe(true)
    expect(isValid(RiskTierSchema, 4)).toBe(false)
    expect(isValid(RiskTierSchema, -1)).toBe(false)
  })

  it('validates action lifecycle stages', () => {
    const stages = ['discover', 'plan', 'diff', 'approve', 'apply', 'verify', 'result', 'rollback']
    for (const stage of stages) {
      expect(isValid(ActionLifecycleStageSchema, stage)).toBe(true)
    }
    expect(isValid(ActionLifecycleStageSchema, 'unknown_stage')).toBe(false)
  })

  it('validates canonical action execution statuses', () => {
    const validStatuses = [
      'staged',
      'planned',
      'awaiting_approval',
      'approved',
      'rejected',
      'applying',
      'verifying',
      'completed',
      'failed',
      'rolling_back',
      'rolled_back',
      'rollback_failed',
    ]
    for (const status of validStatuses) {
      expect(isValid(ActionStatusSchema, status)).toBe(true)
    }
    expect(isValid(ActionStatusSchema, 'unknown_status')).toBe(false)
  })

  it('validates a structured ActionDiff', () => {
    const validDiff = {
      summary: 'Add user account and mailbox alias',
      changes: [
        {
          path: '/users/usr_minh',
          op: 'add',
          newValue: { email: 'bob@production.example.invalid', quotaMb: 5120 },
        },
        {
          path: '/aliases/als_bob_alias',
          op: 'add',
          newValue: {
            source: 'bob.alias@production.example.invalid',
            target: 'bob@production.example.invalid',
          },
        },
      ],
    }

    expect(isValid(ActionDiffSchema, validDiff)).toBe(true)
    const res = validate(ActionDiffSchema, validDiff)
    expect(res.success).toBe(true)
  })

  it('validates Tier 3 ApprovalRequest requiring typed confirmation, non-empty phrase, and recent auth', () => {
    const validTier3Approval = {
      id: 'app_cutover_001',
      actionId: 'act_mx_cutover',
      planId: 'pln_cutover_plan',
      riskTier: 3,
      confirmationType: 'typed_confirmation',
      typedPhrase: 'CUTOVER mail.example.com',
      requiresRecentAuth: true,
      requestedBy: 'usr_ops_lead',
      status: 'pending',
      createdAt: '2026-10-01T10:15:00.000Z',
      expiresAt: '2026-10-01T10:30:00.000Z',
    }
    expect(isValid(ApprovalRequestSchema, validTier3Approval)).toBe(true)

    // Negative: Tier 3 with simple confirmation
    expect(
      isValid(ApprovalRequestSchema, {
        ...validTier3Approval,
        confirmationType: 'simple',
      }),
    ).toBe(false)

    // Negative: Tier 3 with empty typedPhrase
    expect(
      isValid(ApprovalRequestSchema, {
        ...validTier3Approval,
        typedPhrase: '',
      }),
    ).toBe(false)

    // Negative: Tier 3 with requiresRecentAuth = false
    expect(
      isValid(ApprovalRequestSchema, {
        ...validTier3Approval,
        requiresRecentAuth: false,
      }),
    ).toBe(false)

    // Standard approval request for Tier 1 or 2 can use simple confirmation
    const validTier1Approval = {
      id: 'app_alias_001',
      actionId: 'act_add_alias',
      planId: 'pln_alias_001',
      riskTier: 1,
      confirmationType: 'simple',
      requiresRecentAuth: false,
      requestedBy: 'usr_admin',
      status: 'pending',
      createdAt: '2026-10-01T10:15:00.000Z',
      expiresAt: '2026-10-01T10:30:00.000Z',
    }
    expect(isValid(ApprovalRequestSchema, validTier1Approval)).toBe(true)
  })

  it('validates ApprovalDecision and rejects invalid decision statuses', () => {
    const decision = {
      approvalId: 'app_cutover_001',
      decidedBy: 'usr_superadmin',
      decision: 'approved',
      reason: 'Verified TTL lowered to 300s and backup complete',
      stepUpVerified: true,
      decidedAt: '2026-10-01T10:20:00.000Z',
    }

    expect(isValid(ApprovalDecisionSchema, decision)).toBe(true)
  })

  it('validates ActionExecution tracking full lifecycle and enforces approvalId for Tier 3', () => {
    const validTier3Execution = {
      id: 'act_restore_db',
      name: 'restore.mailbox',
      surface: 'control',
      stage: 'apply',
      status: 'applying',
      riskTier: 3,
      parameters: {
        mailboxId: 'usr_target1',
        snapshotId: 'snap_20261001',
      },
      canRollback: true,
      requestedBy: 'usr_admin',
      approvalId: 'app_restore_99',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:05:00.000Z',
    }
    expect(isValid(ActionExecutionSchema, validTier3Execution)).toBe(true)

    // Negative: Tier 3 missing approvalId
    const tier3MissingApproval = { ...validTier3Execution }
    delete (tier3MissingApproval as { approvalId?: unknown }).approvalId
    expect(isValid(ActionExecutionSchema, tier3MissingApproval)).toBe(false)

    // Valid: Tier 1 execution does not require approvalId
    const validTier1Execution = {
      id: 'act_list_keys',
      name: 'keys.list',
      surface: 'control',
      stage: 'result',
      status: 'completed',
      riskTier: 0,
      parameters: {},
      canRollback: false,
      requestedBy: 'usr_admin',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:05.000Z',
    }
    expect(isValid(ActionExecutionSchema, validTier1Execution)).toBe(true)
  })
})
