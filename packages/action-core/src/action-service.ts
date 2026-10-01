import { ActionVerificationSchema } from '@navin/contracts'
import type {
  ActionDiff,
  ActionExecution,
  ActionVerification,
  ApprovalRequest,
  AuditActor,
  NavinError,
  NavinSurface,
  RiskTier,
} from '@navin/contracts'

import { type Clock } from './clock.js'
import { ActionCoreError, toNavinError } from './errors.js'
import type { IdFactory } from './ids.js'
import type { ActionLedger } from './ledger/action-ledger.js'
import type { ApprovalLedger } from './ledger/approval-ledger.js'
import type { AttemptLedger, ActionAttempt } from './ledger/attempt-ledger.js'
import type { AuditLedger } from './ledger/audit-ledger.js'
import type { EventLog } from './ledger/event-log.js'
import type { EvidenceLedger } from './ledger/evidence-ledger.js'
import type { IdempotencyStore } from './ledger/idempotency-store.js'
import { confirmationTypeForRisk, expectedTier3Phrase } from './policy/risk-policy.js'
import type { SqliteDatabase } from './sqlite/database.js'
import type { ExecutorRegistry } from './executor/registry.js'
import type { ActionExecutorPort, ExecutorEmitInput } from './executor/ports.js'
import { assertContract } from './validation.js'

const ACTION_EVENT_CHANNEL = 'system' as const
const INTERRUPTED_MESSAGE = 'Operation was interrupted by a daemon restart'

export interface ActionServiceDeps {
  db: SqliteDatabase
  ids: IdFactory
  clock: Clock
  actions: ActionLedger
  approvals: ApprovalLedger
  attempts: AttemptLedger
  events: EventLog
  evidence: EvidenceLedger
  audit: AuditLedger
  idempotency: IdempotencyStore
  executors: ExecutorRegistry
}

export interface StageActionInput {
  name: string
  surface: NavinSurface
  riskTier: RiskTier
  parameters?: Record<string, unknown>
  requestedBy: string
  canRollback?: boolean
  planId?: string
  idempotencyKey?: string
  actor?: AuditActor
}

export interface StageActionResult {
  action: ActionExecution
  approval?: ApprovalRequest
}

export interface DecideActionApprovalInput {
  decidedBy: string
  decision: 'approved' | 'rejected'
  reason?: string
  stepUpVerified?: boolean
  typedPhrase?: string
  actor?: AuditActor
}

export interface ApplyActionInput {
  executor?: ActionExecutorPort
  idempotencyKey?: string
  force?: boolean
  signal?: AbortSignal
  actor?: AuditActor
}

export interface RollbackActionInput {
  executor?: ActionExecutorPort
  actor?: AuditActor
  signal?: AbortSignal
}

export interface ReconcileActionInput {
  executor?: ActionExecutorPort
  actor?: AuditActor
  signal?: AbortSignal
}

function abortError(): ActionCoreError {
  return new ActionCoreError('SERVICE_UNAVAILABLE', 'Operation aborted by caller', {
    retryable: true,
    details: { aborted: true },
  })
}

/**
 * Orchestrates the full lifecycle:
 * discover -> plan -> diff -> approve -> apply -> verify -> result -> rollback.
 *
 * The service owns all state transitions and risk/approval enforcement; it never
 * performs infrastructure work itself, delegating only to injected executor ports.
 * A mutation is only ever completed with a real, passing verification result.
 */
export class ActionService {
  private readonly inFlightApplies = new Set<string>()
  private readonly inFlightRollbacks = new Set<string>()

  constructor(private readonly deps: ActionServiceDeps) {}

  stageAction(input: StageActionInput): StageActionResult {
    const { db, ids, clock, actions, approvals, idempotency } = this.deps
    const actionId = ids('act')
    const planId = input.planId ?? ids('pln')
    const now = clock().toISOString()

    return db.transaction(() => {
      if (input.idempotencyKey !== undefined) {
        const reservation = idempotency.reserve({
          scope: 'action:stage',
          key: input.idempotencyKey,
          requestHash: idempotency.hashRequest({
            name: input.name,
            surface: input.surface,
            riskTier: input.riskTier,
            parameters: input.parameters ?? {},
            requestedBy: input.requestedBy,
          }),
          resourceType: 'action',
          resourceId: actionId,
          now,
        })
        if (reservation.idempotent) {
          const existing = actions.require(reservation.record.resourceId)
          const pending = approvals.listByAction(existing.id).find((a) => a.riskTier === 3)
          return pending === undefined
            ? { action: existing }
            : { action: existing, approval: pending }
        }
      }

      if (input.riskTier === 3) {
        const approvalId = ids('app')
        const action = actions.create({
          id: actionId,
          name: input.name,
          surface: input.surface,
          riskTier: input.riskTier,
          parameters: input.parameters,
          requestedBy: input.requestedBy,
          canRollback: input.canRollback,
          planId,
          approvalId,
          status: 'awaiting_approval',
          stage: 'approve',
        })
        const approval = approvals.create({
          id: approvalId,
          actionId: action.id,
          planId,
          riskTier: 3,
          confirmationType: 'typed_confirmation',
          typedPhrase: expectedTier3Phrase(action),
          requestedBy: input.requestedBy,
        })
        this.recordAudit(
          action,
          'success',
          input.actor ?? defaultActor(input.requestedBy, 'control'),
          {
            riskTier: input.riskTier,
          },
        )
        return { action, approval }
      }

      const action = actions.create({
        id: actionId,
        name: input.name,
        surface: input.surface,
        riskTier: input.riskTier,
        parameters: input.parameters,
        requestedBy: input.requestedBy,
        canRollback: input.canRollback,
        planId,
      })
      this.recordAudit(
        action,
        'success',
        input.actor ?? defaultActor(input.requestedBy, 'control'),
        {
          riskTier: input.riskTier,
        },
      )
      return { action }
    })
  }

  getAction(id: string): ActionExecution {
    return this.deps.actions.require(id)
  }

  listActions(filter?: Parameters<ActionLedger['list']>[0]): ActionExecution[] {
    return this.deps.actions.list(filter)
  }

  getAttempts(actionId: string): ActionAttempt[] {
    return this.deps.attempts.listByAction(actionId)
  }

  getAttempt(id: string): ActionAttempt {
    return this.deps.attempts.require(id)
  }

  planAction(
    actionId: string,
    options: { diff?: ActionDiff; executor?: ActionExecutorPort; expectedRevision?: number } = {},
  ): Promise<ActionExecution> {
    return this.runPlan(actionId, options)
  }

  private async runPlan(
    actionId: string,
    options: { diff?: ActionDiff; executor?: ActionExecutorPort; expectedRevision?: number },
  ): Promise<ActionExecution> {
    const action = this.deps.actions.require(actionId)
    let diff = options.diff
    if (diff === undefined) {
      const port = options.executor ?? this.deps.executors.findExecutor(action.name)
      if (port?.plan === undefined) {
        throw new ActionCoreError(
          'VALIDATION_FAILED',
          'No plan produced and no executor provides plan()',
          {
            details: { actionId, name: action.name },
          },
        )
      }
      diff = await port.plan(action.parameters, this.contextFor(action))
    }
    return this.deps.db.transaction(() => {
      const updated = this.deps.actions.transition(
        actionId,
        'planned',
        { diff, stage: 'plan' },
        options.expectedRevision,
      )
      this.emit('action.planned', updated.id, { diff })
      return updated
    })
  }

  requestApproval(
    actionId: string,
    options: { ttlMs?: number; actor?: AuditActor } = {},
  ): ApprovalRequest {
    const { db, ids, actions, approvals } = this.deps
    const action = actions.require(actionId)
    if (action.riskTier === 0) {
      throw new ActionCoreError('VALIDATION_FAILED', 'Tier 0 actions do not require approval')
    }
    const planId = actions.getPlanId(actionId) ?? ids('pln')

    return db.transaction(() => {
      const existing = approvals
        .listByAction(actionId)
        .find((candidate) => candidate.status === 'pending')
      const approval =
        existing ??
        approvals.create({
          actionId,
          planId,
          riskTier: action.riskTier,
          confirmationType: confirmationTypeForRisk(action.riskTier),
          ...(action.riskTier === 3 ? { typedPhrase: expectedTier3Phrase(action) } : {}),
          requestedBy: action.requestedBy,
          ttlMs: options.ttlMs,
        })

      if (action.status === 'planned' || action.status === 'staged') {
        actions.transition(actionId, 'awaiting_approval', {
          approvalId: approval.id,
          stage: 'approve',
        })
        this.emit('action.awaiting_approval', actionId, { approvalId: approval.id })
      }
      return approval
    })
  }

  decideApproval(
    approvalId: string,
    input: DecideActionApprovalInput,
  ): { approval: ApprovalRequest; action: ActionExecution } {
    const { db, approvals, actions } = this.deps
    return db.transaction(() => {
      const approval = approvals.require(approvalId)
      const action = actions.require(approval.actionId)

      if (approval.riskTier === 3 && input.decision === 'approved') {
        if (
          approval.typedPhrase === undefined ||
          input.typedPhrase === undefined ||
          input.typedPhrase !== approval.typedPhrase
        ) {
          throw new ActionCoreError(
            'APPROVAL_REQUIRED',
            'Tier 3 approval requires the exact typed confirmation phrase',
            { details: { approvalId } },
          )
        }
        if (input.stepUpVerified !== true) {
          throw new ActionCoreError(
            'RISK_STEP_UP_REQUIRED',
            'Tier 3 approval requires recent authentication',
            { details: { approvalId } },
          )
        }
      }

      const decided = approvals.decide(approvalId, {
        decidedBy: input.decidedBy,
        decision: input.decision,
        reason: input.reason,
        stepUpVerified: input.stepUpVerified,
      })
      const updated = actions.transition(
        action.id,
        input.decision === 'approved' ? 'approved' : 'rejected',
        { approvalId },
      )
      this.recordAudit(
        updated,
        input.decision === 'approved' ? 'success' : 'denied',
        input.actor ?? defaultActor(input.decidedBy, 'control'),
        { approvalId, decision: input.decision },
      )
      this.emit('action.approval_decided', action.id, { approvalId, decision: input.decision })
      return { approval: decided, action: updated }
    })
  }

  async applyAction(actionId: string, input: ApplyActionInput = {}): Promise<ActionExecution> {
    const { db, actions, approvals, executors, attempts } = this.deps
    const action = actions.require(actionId)
    const signal = input.signal

    if (input.idempotencyKey !== undefined) {
      const existing = attempts.findByIdempotencyKey(input.idempotencyKey)
      if (existing !== undefined) {
        if (existing.actionId !== actionId) {
          throw new ActionCoreError(
            'IDEMPOTENCY_CONFLICT',
            `Idempotency key ${input.idempotencyKey} belongs to another action`,
            { details: { actionId, attemptId: existing.id } },
          )
        }
        if (existing.status === 'succeeded') {
          if (action.status === 'completed') {
            return action
          }
          throw new ActionCoreError(
            'CONFLICT',
            `Attempt ${existing.id} succeeded but action ${actionId} is ${action.status}`,
            { details: { actionId, attemptId: existing.id, needsAttention: true } },
          )
        }
        if (existing.status !== 'reserved' && existing.status !== 'aborted') {
          throw new ActionCoreError(
            'ACTION_BLOCKED',
            `Previous execution attempt ${existing.id} has an unknown outcome (${existing.status}); operator attention required before retry`,
            {
              details: {
                actionId,
                attemptId: existing.id,
                attemptStatus: existing.status,
                needsAttention: true,
              },
            },
          )
        }
      }
    }

    const port = input.executor ?? executors.requireExecutor(action.name)
    if (port.apply === undefined) {
      throw new ActionCoreError('ACTION_BLOCKED', `Executor ${port.name} cannot apply`, {
        details: { actionId },
      })
    }
    if (port.verify === undefined) {
      throw new ActionCoreError(
        'ACTION_BLOCKED',
        `Executor ${port.name} does not provide verification; refusing to complete a mutation without verification`,
        { details: { actionId, executor: port.name } },
      )
    }

    this.assertApprovalSatisfied(action, approvals, input.force)

    if (this.inFlightApplies.has(actionId)) {
      throw new ActionCoreError('CONFLICT', `Action ${actionId} is already applying`, {
        details: { actionId },
      })
    }
    this.inFlightApplies.add(actionId)

    let attemptId: string | undefined
    let dispatchCommitted = false
    try {
      const actor = input.actor ?? defaultActor(action.requestedBy, action.surface)
      const attempt = this.beginAttempt(action, input.idempotencyKey)
      attemptId = attempt.id
      const ctx = () => this.contextFor(action, signal, attempt)

      if (signal?.aborted) {
        db.transaction(() => attempts.abort(attempt.id, 'aborted before dispatch'))
        throw abortError()
      }

      // This commit is the dispatch fence: no executor side effect is allowed
      // before the reservation and applying state are durable.
      db.transaction(() => {
        attempts.markDispatched(attempt.id)
        actions.transition(actionId, 'applying')
        this.emit('action.applying', actionId, { attemptId: attempt.id })
        this.recordAudit(action, 'success', actor, { status: 'applying', attemptId: attempt.id })
      })
      dispatchCommitted = true

      let output
      try {
        output = await port.apply(action.parameters, ctx())
      } catch (error) {
        const observedError = signal?.aborted ? abortError() : error
        this.failAttempt(
          action,
          attempt.id,
          toNavinError(observedError, action.surface),
          true,
          actor,
          'unknown',
        )
        throw observedError
      }
      const canRollback = output?.canRollback ?? action.canRollback

      if (signal?.aborted) {
        return this.failAttempt(action, attempt.id, abortError(), true, actor, 'unknown')
      }

      db.transaction(() => {
        actions.transition(actionId, 'verifying')
        this.emit('action.verifying', actionId, { attemptId: attempt.id })
      })

      let verification: ActionVerification
      try {
        verification = await port.verify(action.parameters, ctx())
        assertContract(ActionVerificationSchema, verification, 'action verification')
        assertRealVerification(verification, port.name)
      } catch (error) {
        const observedError = signal?.aborted ? abortError() : error
        return this.failAttempt(
          action,
          attempt.id,
          toNavinError(observedError, action.surface),
          true,
          actor,
          'unknown',
        )
      }

      if (signal?.aborted) {
        return this.failAttempt(action, attempt.id, abortError(), true, actor, 'unknown')
      }

      if (!verification.passed) {
        return this.failVerification(action, attempt.id, verification, canRollback, port, actor)
      }

      return db.transaction(() => {
        const completed = actions.transition(actionId, 'completed', { verification, canRollback })
        attempts.succeed(attempt.id, 'verified')
        this.emit('action.completed', actionId, { attemptId: attempt.id })
        this.recordAudit(completed, 'success', actor, { attemptId: attempt.id })
        return completed
      })
    } catch (error) {
      const current = actions.require(actionId)
      if (
        dispatchCommitted &&
        attemptId !== undefined &&
        (current.status === 'applying' || current.status === 'verifying')
      ) {
        this.failAttempt(
          action,
          attemptId,
          toNavinError(error, action.surface),
          true,
          input.actor ?? defaultActor(action.requestedBy, action.surface),
          'unknown',
        )
      }
      throw signal?.aborted ? abortError() : error
    } finally {
      this.inFlightApplies.delete(actionId)
    }
  }

  async rollbackAction(
    actionId: string,
    input: RollbackActionInput = {},
  ): Promise<ActionExecution> {
    const { db, actions, executors } = this.deps
    const action = actions.require(actionId)
    if (!action.canRollback) {
      throw new ActionCoreError('ACTION_BLOCKED', `Action ${actionId} is not rollbackable`, {
        details: { actionId },
      })
    }
    if (action.error?.details?.needsAttention === true && action.status === 'rollback_failed') {
      throw new ActionCoreError(
        'ACTION_BLOCKED',
        `Rollback outcome for ${actionId} is unknown; reconcile it before retrying`,
        { details: { actionId, needsAttention: true } },
      )
    }
    const port = input.executor ?? executors.requireExecutor(action.name)
    if (port.rollback === undefined) {
      throw new ActionCoreError('ACTION_BLOCKED', `Executor ${port.name} cannot rollback`, {
        details: { actionId },
      })
    }
    if (input.signal?.aborted) {
      throw abortError()
    }
    if (this.inFlightRollbacks.has(actionId)) {
      throw new ActionCoreError('CONFLICT', `Action ${actionId} is already rolling back`, {
        details: { actionId },
      })
    }
    this.inFlightRollbacks.add(actionId)

    db.transaction(() => {
      actions.transition(actionId, 'rolling_back')
      this.emit('action.rolling_back', actionId, {})
    })

    try {
      await port.rollback(action.parameters, this.contextFor(action, input.signal))
      if (input.signal?.aborted) {
        throw abortError()
      }
      return db.transaction(() => {
        const rolledBack = actions.transition(actionId, 'rolled_back')
        this.emit('action.rolled_back', actionId, {})
        this.recordAudit(
          rolledBack,
          'success',
          input.actor ?? defaultActor(action.requestedBy, action.surface),
          {},
        )
        return rolledBack
      })
    } catch (error) {
      const base = toNavinError(input.signal?.aborted ? abortError() : error, action.surface)
      const navinError: NavinError = {
        ...base,
        retryable: false,
        details: { ...(base.details ?? {}), needsAttention: true },
      }
      db.transaction(() => {
        const failed = actions.transition(actionId, 'rollback_failed', { error: navinError })
        this.emit('action.rollback_failed', actionId, {
          message: navinError.message,
          needsAttention: true,
        })
        this.recordAudit(
          failed,
          'failure',
          input.actor ?? defaultActor(action.requestedBy, action.surface),
          { message: navinError.message, needsAttention: true },
        )
      })
      throw error
    } finally {
      this.inFlightRollbacks.delete(actionId)
    }
  }

  resumeAction(actionId: string, input: ApplyActionInput = {}): Promise<ActionExecution> {
    const action = this.deps.actions.require(actionId)
    if (action.status !== 'failed' || action.error?.details?.needsAttention === true) {
      throw new ActionCoreError(
        'ACTION_BLOCKED',
        `Action ${actionId} is not in a known-safe retry state`,
        { details: { actionId, needsAttention: action.error?.details?.needsAttention === true } },
      )
    }
    return this.applyAction(actionId, input)
  }

  async reconcileUnknownAction(
    actionId: string,
    input: ReconcileActionInput = {},
  ): Promise<ActionExecution> {
    const { actions, attempts, db, executors } = this.deps
    const action = actions.require(actionId)
    const attempt = attempts.latestForAction(actionId)
    if (
      action.status !== 'failed' ||
      action.error?.details?.needsAttention !== true ||
      attempt === undefined ||
      attempt.status !== 'unknown'
    ) {
      throw new ActionCoreError(
        'ACTION_BLOCKED',
        `Action ${actionId} has no unknown outcome requiring reconciliation`,
        { details: { actionId, needsAttention: true } },
      )
    }
    const port = input.executor ?? executors.requireExecutor(action.name)
    if (port.verify === undefined) {
      throw new ActionCoreError('ACTION_BLOCKED', `Executor ${port.name} cannot verify`, {
        details: { actionId },
      })
    }
    if (input.signal?.aborted) {
      throw abortError()
    }

    db.transaction(() => {
      actions.transition(actionId, 'verifying')
      this.emit('action.reconciling', actionId, { attemptId: attempt.id })
    })

    let verification: ActionVerification
    try {
      verification = await port.verify(
        action.parameters,
        this.contextFor(action, input.signal, attempt),
      )
      assertContract(ActionVerificationSchema, verification, 'action verification')
      assertRealVerification(verification, port.name)
    } catch (error) {
      return this.failAttempt(
        action,
        attempt.id,
        toNavinError(error, action.surface),
        true,
        input.actor ?? defaultActor(action.requestedBy, action.surface),
        'unknown',
      )
    }

    if (input.signal?.aborted) {
      return this.failAttempt(
        action,
        attempt.id,
        abortError(),
        true,
        input.actor ?? defaultActor(action.requestedBy, action.surface),
        'unknown',
      )
    }
    if (!verification.passed) {
      return this.failVerification(
        action,
        attempt.id,
        verification,
        action.canRollback,
        port,
        input.actor ?? defaultActor(action.requestedBy, action.surface),
      )
    }

    return db.transaction(() => {
      const completed = actions.transition(actionId, 'completed', { verification })
      attempts.succeed(attempt.id, 'verified during reconciliation')
      this.emit('action.completed', actionId, { attemptId: attempt.id, reconciled: true })
      this.recordAudit(
        completed,
        'success',
        input.actor ?? defaultActor(action.requestedBy, action.surface),
        { attemptId: attempt.id, reconciled: true },
      )
      return completed
    })
  }
  /**
   * Reconciles work left mid-flight by a previous process.
   *
   * An attempt that reached `dispatched` means the external side effect may have
   * happened, so the action is marked failed with `needsAttention` and a
   * non-retryable error rather than a safe retry. An attempt still `reserved`
   * never left the process, so it is aborted and remains safe to retry.
   */
  recoverInterrupted(actor?: AuditActor): ActionExecution[] {
    const { db, actions, attempts, clock } = this.deps
    const stuck = actions.list({ statuses: ['applying', 'verifying', 'rolling_back'], limit: 1000 })
    return db.transaction(() =>
      stuck.map((action) => {
        const who = actor ?? defaultActor(action.requestedBy, action.surface)

        if (action.status === 'rolling_back') {
          const failed = actions.transition(action.id, 'rollback_failed', {
            error: interruptedError(clock, false, true),
          })
          this.emit('action.interrupted', action.id, {
            status: 'rollback_failed',
            needsAttention: true,
          })
          this.recordAudit(failed, 'failure', who, { reason: 'interrupted', needsAttention: true })
          return failed
        }

        const attempt = attempts.latestForAction(action.id)
        let needsAttention = true
        let retryable = false
        if (attempt !== undefined && attempt.status === 'reserved') {
          attempts.abort(attempt.id, 'interrupted before dispatch')
          needsAttention = false
          retryable = true
        } else if (attempt !== undefined && attempt.status === 'dispatched') {
          attempts.markUnknown(attempt.id, 'interrupted after dispatch')
        }

        const updated = actions.transition(action.id, 'failed', {
          error: interruptedError(clock, retryable, needsAttention),
        })
        this.emit('action.interrupted', action.id, {
          ...(attempt === undefined ? {} : { attemptId: attempt.id }),
          needsAttention,
        })
        this.recordAudit(updated, 'failure', who, { reason: 'interrupted', needsAttention })
        return updated
      }),
    )
  }

  private beginAttempt(action: ActionExecution, idempotencyKey?: string): ActionAttempt {
    const { db, attempts, idempotency, clock } = this.deps
    const now = clock().toISOString()
    return db.transaction(() => {
      if (idempotencyKey !== undefined) {
        idempotency.reserve({
          scope: 'action:apply',
          key: idempotencyKey,
          requestHash: idempotency.hashRequest({
            actionId: action.id,
            parameters: action.parameters,
          }),
          resourceType: 'action',
          resourceId: action.id,
          now,
        })
        const existing = attempts.findByIdempotencyKey(idempotencyKey)
        if (existing !== undefined) {
          return existing
        }
      }
      return attempts.begin({ actionId: action.id, idempotencyKey, now })
    })
  }

  private failAttempt(
    action: ActionExecution,
    attemptId: string | undefined,
    error: NavinError | ActionCoreError,
    needsAttention: boolean,
    actor: AuditActor,
    attemptOutcome: 'failed' | 'unknown' = 'failed',
  ): ActionExecution {
    const navinError = error instanceof ActionCoreError ? error.toNavinError(action.surface) : error
    const shaped: NavinError = needsAttention
      ? {
          ...navinError,
          retryable: false,
          details: { ...(navinError.details ?? {}), needsAttention: true },
        }
      : navinError

    return this.deps.db.transaction(() => {
      const updated = this.deps.actions.transition(action.id, 'failed', { error: shaped })
      if (attemptId !== undefined) {
        if (attemptOutcome === 'unknown') {
          this.deps.attempts.markUnknown(attemptId, navinError.message)
        } else {
          this.deps.attempts.fail(attemptId, navinError.message)
        }
      }
      this.emit('action.failed', action.id, {
        message: navinError.message,
        needsAttention,
        ...(attemptId === undefined ? {} : { attemptId }),
      })
      this.recordAudit(updated, 'failure', actor, {
        message: navinError.message,
        needsAttention,
        ...(attemptId === undefined ? {} : { attemptId }),
      })
      return updated
    })
  }

  private failVerification(
    action: ActionExecution,
    attemptId: string,
    verification: ActionVerification,
    canRollback: boolean,
    port: ActionExecutorPort,
    actor: AuditActor,
  ): ActionExecution {
    const error: NavinError = {
      code: 'PRECONDITION_FAILED',
      message: `Verification failed for ${action.name}`,
      retryable: false,
      details: {
        needsAttention: true,
        command: verification.command,
        expected: verification.expected,
        actual: verification.actual,
        attemptId,
      },
      timestamp: this.deps.clock().toISOString(),
    }

    return this.deps.db.transaction(() => {
      const updated = this.deps.actions.transition(action.id, 'failed', {
        error,
        canRollback: canRollback && port.rollback !== undefined,
      })
      this.deps.attempts.fail(attemptId, 'verification_failed')
      this.deps.evidence.append({
        checkType: 'custom_check',
        status: 'failed',
        target: action.name,
        collector: `action-core:${port.name}`,
        details: {
          actionId: action.id,
          attemptId,
          command: verification.command,
          expected: verification.expected,
          actual: verification.actual,
          passed: verification.passed,
        },
      })
      this.emit('action.verification_failed', action.id, {
        attemptId,
        command: verification.command,
      })
      this.recordAudit(updated, 'failure', actor, {
        attemptId,
        reason: 'verification_failed',
      })
      return updated
    })
  }

  private assertApprovalSatisfied(
    action: ActionExecution,
    approvals: ApprovalLedger,
    force: boolean | undefined,
  ): void {
    if (action.riskTier < 2) {
      return
    }
    const approved = approvals
      .listByAction(action.id)
      .find(
        (candidate) =>
          candidate.status === 'approved' && candidate.decision?.decision === 'approved',
      )

    if (approved === undefined) {
      if (force === true && action.riskTier === 3) {
        throw new ActionCoreError(
          'FORBIDDEN',
          'Tier 3 actions cannot be forced; typed approval and recent authentication are required',
          { details: { actionId: action.id } },
        )
      }
      throw new ActionCoreError('APPROVAL_REQUIRED', `Action ${action.id} requires approval`, {
        details: { actionId: action.id, riskTier: action.riskTier },
      })
    }

    if (action.riskTier === 3) {
      if (approved.confirmationType !== 'typed_confirmation') {
        throw new ActionCoreError(
          'APPROVAL_REQUIRED',
          'Tier 3 action requires typed confirmation',
          {
            details: { actionId: action.id },
          },
        )
      }
      if (approved.decision?.stepUpVerified !== true) {
        throw new ActionCoreError(
          'RISK_STEP_UP_REQUIRED',
          'Tier 3 action requires step-up verified approval',
          { details: { actionId: action.id } },
        )
      }
    }

    if (action.riskTier === 2 && approved.confirmationType !== 'explicit_diff') {
      throw new ActionCoreError(
        'APPROVAL_REQUIRED',
        'Tier 2 action requires explicit diff approval',
        {
          details: { actionId: action.id },
        },
      )
    }
  }

  private contextFor(
    action: ActionExecution,
    signal?: AbortSignal,
    attempt?: ActionAttempt,
  ): {
    actionId: string
    surface: NavinSurface
    signal?: AbortSignal
    attemptId?: string
    idempotencyKey?: string
    callerIdempotencyKey?: string
    emitEvent: (input: ExecutorEmitInput) => void
  } {
    return {
      actionId: action.id,
      surface: action.surface,
      signal,
      ...(attempt === undefined
        ? {}
        : {
            attemptId: attempt.id,
            idempotencyKey: attempt.externalIdempotencyKey,
            ...(attempt.idempotencyKey === undefined
              ? {}
              : { callerIdempotencyKey: attempt.idempotencyKey }),
          }),
      emitEvent: (input: ExecutorEmitInput) =>
        this.deps.events.append({
          kind: input.kind,
          channel: ACTION_EVENT_CHANNEL,
          actionId: action.id,
          data: input.data,
          metadata: input.metadata,
        }),
    }
  }

  private emit(kind: string, actionId: string, data: Record<string, unknown>): void {
    this.deps.events.append({ kind, channel: ACTION_EVENT_CHANNEL, actionId, data })
  }

  private recordAudit(
    action: ActionExecution,
    outcome: 'success' | 'failure' | 'denied',
    actor: AuditActor,
    details: Record<string, unknown>,
  ): void {
    this.deps.audit.append({
      actor,
      actionName: action.name,
      target: { actionId: action.id, resourceType: 'action' },
      outcome,
      riskTier: action.riskTier,
      ...(action.approvalId === undefined ? {} : { approvalId: action.approvalId }),
      details,
    })
  }
}

function defaultActor(userId: string, surface: NavinSurface): AuditActor {
  return { userId, role: 'ops.operator', surface }
}

function interruptedError(clock: Clock, retryable: boolean, needsAttention: boolean): NavinError {
  return {
    code: 'SERVICE_UNAVAILABLE',
    message: needsAttention
      ? `${INTERRUPTED_MESSAGE}; outcome is unknown and requires operator attention`
      : INTERRUPTED_MESSAGE,
    retryable,
    details: { needsAttention },
    timestamp: clock().toISOString(),
  }
}

function assertRealVerification(verification: ActionVerification, executorName: string): void {
  if (
    !Object.prototype.hasOwnProperty.call(verification, 'actual') ||
    verification.actual === undefined
  ) {
    throw new ActionCoreError(
      'VALIDATION_FAILED',
      `Executor ${executorName} returned metadata-only verification; an observed actual value is required`,
      { details: { executor: executorName, metadataOnly: true } },
    )
  }
}
