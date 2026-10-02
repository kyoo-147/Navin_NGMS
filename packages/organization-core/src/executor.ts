import type {
  ActionApplyResult,
  ActionExecutorPort,
  Clock,
  ExecutorContext,
} from '@navin/action-core'
import type { ActionDiff, ActionDiffChange, ActionVerification } from '@navin/contracts'
import type {
  AliasSpec,
  DomainSpec,
  EngineApplyResult,
  EngineCallOptions,
  EngineDiscoveryReport,
  EnginePlan,
  EnginePlanStep,
  EngineResourceKind,
  EngineRollbackResult,
  EngineVerifyResult,
  MailEngineAdapter,
} from '@navin/engine-core'

import { validateAliasRequest, type ValidatedAliasRequest } from './alias.js'
import { validateDomainRequest, type ValidatedDomainRequest } from './domain.js'
import { OrganizationError, toOrganizationError } from './errors.js'
import { ALIAS_ACTION_NAME, DOMAIN_ACTION_NAME } from './names.js'
import type { OrganizationStore } from './store.js'

export const ORGANIZATION_EXECUTOR_NAME = 'organization'

export function diffFromEnginePlan(plan: EnginePlan): ActionDiff {
  const changes: ActionDiffChange[] = plan.diff.changes.map((change) => ({
    path: change.path,
    op: change.op,
    ...(change.oldValue === undefined ? {} : { oldValue: change.oldValue }),
    ...(change.newValue === undefined ? {} : { newValue: change.newValue }),
  }))
  return { summary: plan.diff.summary, changes }
}

export interface ReversibleResourceDescriptor<Request, Spec> {
  actionName: string
  kind: EngineResourceKind
  parseRequest(parameters: Record<string, unknown>): Request
  toSpec(request: Request): Spec
  /** Rebuilds the engine spec from the persisted plan step for rollback proof. */
  specFromStep(step: EnginePlanStep): Spec
  plan(engine: MailEngineAdapter, spec: Spec, options: EngineCallOptions): Promise<EnginePlan>
  /**
   * Optional pre-destroy guard. Returning normally allows the rollback to
   * proceed; throwing aborts it. Used to refuse destroying a domain that has
   * acquired dependent mailboxes or aliases since it was created.
   */
  guardRollback?(
    engine: MailEngineAdapter,
    step: EnginePlanStep,
    options: EngineCallOptions,
  ): Promise<void>
}

export interface ReversibleExecutorDeps {
  engine: MailEngineAdapter | null
  store: OrganizationStore
  clock: Clock
}

function readString(step: EnginePlanStep, key: string): string | undefined {
  const value = step.desired[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Action executor for a *create-only* reversible resource.
 *
 * It owns no engine logic of its own: every read and mutation crosses the
 * `MailEngineAdapter` boundary. The exact engine plan produced at plan time is
 * persisted so apply/verify/rollback act on the same observed snapshot, and no
 * memory-only fallback is ever treated as success.
 *
 * Create-only safety: a plan whose observed state already exists but differs
 * (`op === 'update'`) is refused *before* any mutation. Reproducing an exact
 * existing resource is an allowed no-op with no rollback. Only a resource this
 * action created can be rolled back, and rollback proves absence upstream.
 */
export class ReversibleCreateExecutor<Request, Spec> implements ActionExecutorPort {
  readonly name: string

  constructor(
    private readonly descriptor: ReversibleResourceDescriptor<Request, Spec>,
    private readonly deps: ReversibleExecutorDeps,
  ) {
    this.name = descriptor.actionName
  }

  async plan(parameters: Record<string, unknown>, ctx: ExecutorContext): Promise<ActionDiff> {
    const request = this.descriptor.parseRequest(parameters)
    const engine = this.requireEngine()
    let enginePlan: EnginePlan
    try {
      enginePlan = await this.descriptor.plan(
        engine,
        this.descriptor.toSpec(request),
        this.callOptions(ctx),
      )
    } catch (error) {
      throw toOrganizationError(error)
    }
    const step = enginePlan.steps[0]
    this.deps.store.savePlan({
      actionId: ctx.actionId,
      resourceKind: this.descriptor.kind,
      resourceKey: step?.target ?? '',
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
    const step = record.enginePlan.steps[0]
    if (step?.op === 'update') {
      throw new OrganizationError(
        'PRECONDITION_FAILED',
        `Refusing to update a pre-existing ${record.resourceKind} this create action does not own`,
        {
          details: {
            actionId: ctx.actionId,
            kind: record.resourceKind,
            target: step.target,
            observed: step.observed,
          },
        },
      )
    }

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
      const failed = result.steps.find((entry) => entry.status === 'failed')
      throw new OrganizationError(
        failed?.error?.code ?? 'ACTION_BLOCKED',
        failed?.error?.message ?? `Engine rejected the ${record.resourceKind} mutation`,
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
      canRollback: step?.op === 'create',
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
    const step = record.enginePlan.steps[0]
    return {
      command: check?.command ?? `verify ${record.resourceKind} ${step?.target ?? ''}`,
      expected: step?.desired ?? {},
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
        `Refusing to roll back a ${record.resourceKind} this action did not create`,
        { details: { actionId: ctx.actionId, op: step?.op ?? 'unknown' } },
      )
    }

    if (this.descriptor.guardRollback !== undefined) {
      await this.descriptor.guardRollback(engine, step, this.callOptions(ctx))
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
    // remove the resource must never be recorded as a clean rolled-back state.
    let after: EnginePlan
    try {
      after = await this.descriptor.plan(
        engine,
        this.descriptor.specFromStep(step),
        this.callOptions(ctx),
      )
    } catch (error) {
      throw toOrganizationError(error, { needsAttention: true })
    }
    const afterStep = after.steps[0]
    if (afterStep?.op !== 'create' || afterStep.observed !== undefined) {
      throw new OrganizationError(
        'PRECONDITION_FAILED',
        `Rollback did not remove the ${record.resourceKind}; operator attention required`,
        { details: { actionId: ctx.actionId, needsAttention: true } },
      )
    }
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
        `Mail engine is not configured; ${this.descriptor.kind} provisioning is unavailable`,
        { retryable: true, details: { reason: 'engine_unconfigured' } },
      )
    }
    return this.deps.engine
  }

  private callOptions(ctx: ExecutorContext): EngineCallOptions {
    return ctx.signal === undefined ? {} : { signal: ctx.signal }
  }
}

function readAliasRequest(parameters: Record<string, unknown>): ValidatedAliasRequest {
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
    ...(typeof parameters.description === 'string' ? { description: parameters.description } : {}),
  })
}

function readDomainRequest(parameters: Record<string, unknown>): ValidatedDomainRequest {
  const name = parameters.name
  if (typeof name !== 'string') {
    throw new OrganizationError('VALIDATION_FAILED', 'Domain action parameters are missing name')
  }
  return validateDomainRequest({
    name,
    ...(typeof parameters.description === 'string' ? { description: parameters.description } : {}),
    ...(typeof parameters.dkimSigning === 'boolean' ? { dkimSigning: parameters.dkimSigning } : {}),
  })
}

const ALIAS_DESCRIPTOR: ReversibleResourceDescriptor<ValidatedAliasRequest, AliasSpec> = {
  actionName: ALIAS_ACTION_NAME,
  kind: 'alias',
  parseRequest: readAliasRequest,
  toSpec: (request) => ({
    address: request.address,
    target: request.target,
    ...(request.description === undefined ? {} : { description: request.description }),
  }),
  specFromStep: (step) => ({
    address: step.target,
    target: readString(step, 'target') ?? step.target,
    ...(readString(step, 'description') === undefined
      ? {}
      : { description: readString(step, 'description') as string }),
  }),
  plan: (engine, spec, options) => engine.planAlias(spec, options),
}

/**
 * Refuses to destroy a domain that acquired dependent mailboxes or aliases
 * after it was created.
 *
 * Engine snapshot equality only covers the domain record, so a matching domain
 * snapshot can still have children that a delete would orphan. Discovery runs
 * fresh here; a discovery failure is never a licence to destroy, so it fails
 * closed with operator attention. Only safe counts and the domain id are
 * reported.
 */
async function assertNoDependentChildren(
  engine: MailEngineAdapter,
  step: EnginePlanStep,
  options: EngineCallOptions,
): Promise<void> {
  let report: EngineDiscoveryReport
  try {
    report = await engine.discover(options)
  } catch (error) {
    throw toOrganizationError(error, { needsAttention: true })
  }

  // `discover` is fail-soft: it returns empty arrays while recording warnings
  // for resources it could not enumerate. A report with warnings cannot prove
  // complete dependency enumeration, so it is never a licence to destroy. Only
  // the warning count is surfaced; raw warning text may contain endpoint
  // details.
  if (report.warnings.length > 0) {
    throw new OrganizationError(
      'ACTION_BLOCKED',
      'Refusing to roll back a domain: the engine reported warnings during dependency discovery',
      { details: { needsAttention: true, warningCount: report.warnings.length } },
    )
  }

  const domain = report.domains.find((entry) => entry.name === step.target)
  if (domain === undefined) {
    // Absent upstream: there is nothing to destroy, let the engine path decide.
    return
  }
  const mailboxCount = report.mailboxes.filter((entry) => entry.domainId === domain.id).length
  const aliasCount = report.aliases.filter((entry) => entry.domainId === domain.id).length
  if (mailboxCount > 0 || aliasCount > 0) {
    throw new OrganizationError(
      'ACTION_BLOCKED',
      'Refusing to roll back a domain that has dependent mailboxes or aliases',
      { details: { domainId: domain.id, mailboxCount, aliasCount } },
    )
  }
}

const DOMAIN_DESCRIPTOR: ReversibleResourceDescriptor<ValidatedDomainRequest, DomainSpec> = {
  actionName: DOMAIN_ACTION_NAME,
  kind: 'domain',
  parseRequest: readDomainRequest,
  toSpec: (request) => ({
    name: request.name,
    ...(request.description === undefined ? {} : { description: request.description }),
    ...(request.dkimSigning === undefined ? {} : { dkimSigning: request.dkimSigning }),
  }),
  specFromStep: (step) => ({
    name: step.target,
    ...(readString(step, 'description') === undefined
      ? {}
      : { description: readString(step, 'description') as string }),
    ...(typeof step.desired.dkimSigning === 'boolean'
      ? { dkimSigning: step.desired.dkimSigning }
      : {}),
  }),
  plan: (engine, spec, options) => engine.planDomain(spec, options),
  guardRollback: assertNoDependentChildren,
}

export function createAliasProvisioningExecutor(deps: ReversibleExecutorDeps): ActionExecutorPort {
  return new ReversibleCreateExecutor(ALIAS_DESCRIPTOR, deps)
}

export function createDomainProvisioningExecutor(deps: ReversibleExecutorDeps): ActionExecutorPort {
  return new ReversibleCreateExecutor(DOMAIN_DESCRIPTOR, deps)
}
