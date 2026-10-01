import type {
  ActionApplyResult,
  ActionExecutorPort,
  Clock,
  ExecutorContext,
} from '@navin/action-core'
import type { ActionDiff, ActionDiffChange, ActionVerification } from '@navin/contracts'
import type {
  AliasSpec,
  EngineApplyResult,
  EnginePlan,
  EngineRollbackResult,
  EngineVerifyResult,
  MailEngineAdapter,
} from '@navin/engine-core'

import { validateAliasRequest, type ValidatedAliasRequest } from './alias.js'
import { OrganizationError, toOrganizationError } from './errors.js'
import type { OrganizationStore } from './store.js'

export const ORGANIZATION_EXECUTOR_NAME = 'organization'

function toAliasSpec(request: ValidatedAliasRequest): AliasSpec {
  return {
    address: request.address,
    target: request.target,
    ...(request.description === undefined ? {} : { description: request.description }),
  }
}

export function diffFromEnginePlan(plan: EnginePlan): ActionDiff {
  const changes: ActionDiffChange[] = plan.diff.changes.map((change) => ({
    path: change.path,
    op: change.op,
    ...(change.oldValue === undefined ? {} : { oldValue: change.oldValue }),
    ...(change.newValue === undefined ? {} : { newValue: change.newValue }),
  }))
  return { summary: plan.diff.summary, changes }
}

/**
 * Action executor for reversible alias provisioning.
 *
 * It owns no engine logic of its own: every read and mutation crosses the
 * `MailEngineAdapter` boundary. The exact engine plan produced at plan time is
 * persisted so apply/verify/rollback act on the same observed snapshot, and no
 * memory-only fallback is ever treated as success.
 */
export class AliasProvisioningExecutor implements ActionExecutorPort {
  readonly name = ORGANIZATION_EXECUTOR_NAME

  constructor(
    private readonly deps: {
      engine: MailEngineAdapter | null
      store: OrganizationStore
      clock: Clock
    },
  ) {}

  async plan(parameters: Record<string, unknown>, ctx: ExecutorContext): Promise<ActionDiff> {
    const request = this.readRequest(parameters)
    const engine = this.requireEngine()
    let enginePlan: EnginePlan
    try {
      enginePlan = await engine.planAlias(toAliasSpec(request), this.callOptions(ctx))
    } catch (error) {
      throw toOrganizationError(error)
    }
    this.deps.store.savePlan({
      actionId: ctx.actionId,
      request,
      enginePlan,
      createdAt: this.deps.clock().toISOString(),
    })
    return diffFromEnginePlan(enginePlan)
  }

  async apply(
    _parameters: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ActionApplyResult> {
    const record = this.requirePlan(ctx)
    const engine = this.requireEngine()
    let result: EngineApplyResult
    try {
      result = await engine.apply(record.enginePlan, {
        ...this.callOptions(ctx),
        ...(ctx.idempotencyKey === undefined ? {} : { idempotencyKey: ctx.idempotencyKey }),
      })
    } catch (error) {
      throw toOrganizationError(error, { needsAttention: true })
    }
    if (!result.ok) {
      const failed = result.steps.find((step) => step.status === 'failed')
      throw new OrganizationError(
        failed?.error?.code ?? 'ACTION_BLOCKED',
        failed?.error?.message ?? 'Engine rejected the alias mutation',
        {
          details: {
            planId: result.planId,
            steps: result.steps,
            rolledBack: result.rolledBack,
            needsAttention: true,
          },
        },
      )
    }
    const resourceId = Object.values(result.appliedResourceIds)[0]
    return {
      result: {
        planId: result.planId,
        appliedAt: result.appliedAt,
        steps: result.steps,
        appliedResourceIds: result.appliedResourceIds,
        ...(resourceId === undefined ? {} : { resourceId }),
      },
      canRollback: !record.enginePlan.noOp,
    }
  }

  async verify(
    _parameters: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ActionVerification> {
    const record = this.requirePlan(ctx)
    const engine = this.requireEngine()
    let result: EngineVerifyResult
    try {
      result = await engine.verify(record.enginePlan, this.callOptions(ctx))
    } catch (error) {
      throw toOrganizationError(error, { needsAttention: true })
    }
    const check = result.checks[0]
    return {
      command: `verify alias ${record.address}`,
      expected: record.enginePlan.steps[0]?.desired ?? {
        address: record.address,
        target: record.target,
      },
      actual: check?.actual ?? { present: false },
      passed: result.passed === true && check?.passed === true,
      details: {
        planId: result.planId,
        verifiedAt: result.verifiedAt,
        checks: result.checks,
      },
    }
  }

  async rollback(_parameters: Record<string, unknown>, ctx: ExecutorContext): Promise<void> {
    const record = this.requirePlan(ctx)
    const engine = this.requireEngine()
    const step = record.enginePlan.steps[0]
    if (record.enginePlan.noOp || step?.op !== 'create') {
      throw new OrganizationError(
        'ACTION_BLOCKED',
        'Refusing to roll back an alias this action did not create',
        { details: { actionId: ctx.actionId, op: step?.op ?? 'unknown' } },
      )
    }

    let result: EngineRollbackResult
    try {
      result = await engine.rollback(record.enginePlan, this.callOptions(ctx))
    } catch (error) {
      throw toOrganizationError(error, { needsAttention: true })
    }
    if (result.passed !== true) {
      throw new OrganizationError('ACTION_BLOCKED', 'Engine rollback failed', {
        details: { planId: result.planId, steps: result.steps, needsAttention: true },
      })
    }

    // Prove absence by re-reading upstream; a rollback that did not actually
    // remove the alias must never be recorded as a clean rolled-back state.
    let after: EnginePlan
    try {
      after = await engine.planAlias(
        toAliasSpec({ address: record.address, target: record.target }),
        this.callOptions(ctx),
      )
    } catch (error) {
      throw toOrganizationError(error, { needsAttention: true })
    }
    const afterStep = after.steps[0]
    if (afterStep?.op !== 'create' || afterStep.observed !== undefined) {
      throw new OrganizationError(
        'PRECONDITION_FAILED',
        'Rollback did not remove the alias; operator attention required',
        { details: { actionId: ctx.actionId, needsAttention: true } },
      )
    }
  }

  private readRequest(parameters: Record<string, unknown>): ValidatedAliasRequest {
    const address = parameters.address
    const target = parameters.target
    if (typeof address !== 'string' || typeof target !== 'string') {
      throw new OrganizationError(
        'VALIDATION_FAILED',
        'Alias action parameters are missing address or target',
      )
    }
    return validateAliasRequest({
      address,
      target,
      ...(typeof parameters.description === 'string'
        ? { description: parameters.description }
        : {}),
    })
  }

  private requirePlan(ctx: ExecutorContext) {
    const record = this.deps.store.getPlan(ctx.actionId)
    if (record === undefined) {
      throw new OrganizationError(
        'ACTION_BLOCKED',
        'No persisted engine plan for this action; refusing to touch the engine',
        { details: { actionId: ctx.actionId } },
      )
    }
    return record
  }

  private requireEngine(): MailEngineAdapter {
    if (this.deps.engine === null) {
      throw new OrganizationError(
        'SERVICE_UNAVAILABLE',
        'Mail engine is not configured; alias provisioning is unavailable',
        { retryable: true, details: { reason: 'engine_unconfigured' } },
      )
    }
    return this.deps.engine
  }

  private callOptions(ctx: ExecutorContext): { signal?: AbortSignal } {
    return ctx.signal === undefined ? {} : { signal: ctx.signal }
  }
}
