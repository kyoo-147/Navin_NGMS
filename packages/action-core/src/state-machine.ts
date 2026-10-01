import type { ActionLifecycleStage, ActionStatus } from '@navin/contracts'

import { ActionCoreError } from './errors.js'

export const LIFECYCLE_ORDER: readonly ActionLifecycleStage[] = [
  'discover',
  'plan',
  'diff',
  'approve',
  'apply',
  'verify',
  'result',
  'rollback',
]

export const ACTION_TRANSITIONS: Readonly<Record<ActionStatus, readonly ActionStatus[]>> = {
  staged: ['planned', 'awaiting_approval', 'applying', 'rejected', 'failed'],
  planned: ['awaiting_approval', 'approved', 'applying', 'rejected', 'failed'],
  awaiting_approval: ['approved', 'rejected', 'applying', 'failed'],
  approved: ['applying', 'rejected', 'failed'],
  rejected: [],
  applying: ['verifying', 'completed', 'failed', 'rolling_back'],
  verifying: ['completed', 'failed', 'rolling_back'],
  completed: ['rolling_back'],
  failed: ['applying', 'verifying', 'rolling_back'],
  rolling_back: ['rolled_back', 'rollback_failed'],
  rolled_back: [],
  rollback_failed: ['rolling_back'],
}

const STATUS_ALLOWED_STAGES: Readonly<Record<ActionStatus, readonly ActionLifecycleStage[]>> = {
  staged: ['discover'],
  planned: ['plan'],
  awaiting_approval: ['diff', 'approve'],
  approved: ['approve'],
  rejected: ['approve'],
  applying: ['apply'],
  verifying: ['verify'],
  completed: ['result'],
  failed: ['discover', 'plan', 'diff', 'approve', 'apply', 'verify', 'result'],
  rolling_back: ['rollback'],
  rolled_back: ['rollback'],
  rollback_failed: ['rollback'],
}

const TERMINAL_STATUSES: readonly ActionStatus[] = ['rejected', 'rolled_back', 'rollback_failed']

export function canTransition(from: ActionStatus, to: ActionStatus): boolean {
  return ACTION_TRANSITIONS[from].includes(to)
}

export function assertTransition(from: ActionStatus, to: ActionStatus): void {
  if (!canTransition(from, to)) {
    throw new ActionCoreError('CONFLICT', `Illegal action transition: ${from} -> ${to}`, {
      details: { from, to, allowed: ACTION_TRANSITIONS[from] },
    })
  }
}

export function isTerminalStatus(status: ActionStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function allowedStagesForStatus(status: ActionStatus): readonly ActionLifecycleStage[] {
  return STATUS_ALLOWED_STAGES[status]
}

export function isStageAllowedForStatus(
  status: ActionStatus,
  stage: ActionLifecycleStage,
): boolean {
  return STATUS_ALLOWED_STAGES[status].includes(stage)
}

export function canonicalStageForStatus(status: ActionStatus): ActionLifecycleStage {
  const stages = STATUS_ALLOWED_STAGES[status]
  const [first] = stages
  if (first === undefined) {
    throw new ActionCoreError('INTERNAL_ERROR', `No stage mapping for status ${status}`)
  }
  return first
}

export function assertStageForStatus(status: ActionStatus, stage: ActionLifecycleStage): void {
  if (!isStageAllowedForStatus(status, stage)) {
    throw new ActionCoreError('CONFLICT', `Stage ${stage} is not valid for status ${status}`, {
      details: { status, stage, allowed: STATUS_ALLOWED_STAGES[status] },
    })
  }
}

export function lifecycleIndex(stage: ActionLifecycleStage): number {
  return LIFECYCLE_ORDER.indexOf(stage)
}
