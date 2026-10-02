import {
  ActionCore,
  ActionCoreError,
  type ActionAttempt,
  type Clock,
  type JobHandlerContext,
  type JobHandlerPort,
} from '@navin/action-core'
import type {
  ActionExecution,
  ApprovalRequest,
  AuditActor,
  EvidenceRecord,
  Job,
  NavinSurface,
} from '@navin/contracts'
import type { EngineResourceKind, MailEngineAdapter } from '@navin/engine-core'

import {
  derivedAliasIdempotencyKey,
  validateAliasRequest,
  validateIdempotencyKey,
  type AliasProvisioningInput,
  type ValidatedAliasRequest,
} from './alias.js'
import {
  derivedDomainIdempotencyKey,
  validateDomainRequest,
  type DomainProvisioningInput,
  type ValidatedDomainRequest,
} from './domain.js'
import { OrganizationError } from './errors.js'
import {
  createAliasProvisioningExecutor,
  createDomainProvisioningExecutor,
  createMailboxProvisioningExecutor,
} from './executor.js'
import {
  derivedMailboxIdempotencyKey,
  MailboxSecretBroker,
  validateMailboxPassword,
  validateMailboxRequest,
  type MailboxProvisioningInput,
  type ValidatedMailboxRequest,
} from './mailbox.js'
import {
  ALIAS_ACTION_NAME,
  ALIAS_JOB_NAME,
  DOMAIN_ACTION_NAME,
  DOMAIN_JOB_NAME,
  MAILBOX_ACTION_NAME,
  MAILBOX_JOB_NAME,
} from './names.js'
import { OrganizationStore } from './store.js'

export interface OrganizationServiceDeps {
  core: ActionCore
  engine: MailEngineAdapter | null
  clock: Clock
  surface?: NavinSurface
}

export interface PlanActionOptions {
  requestedBy: string
  idempotencyKey?: string
  actor?: AuditActor
}

export interface ProvisionActionOptions extends PlanActionOptions {
  /** Ordinary Tier 1 confirmation. Non-interactive callers fail closed without it. */
  confirm: boolean
}

export interface RollbackActionOptions {
  actor?: AuditActor
}

export interface OrganizationActionView {
  action: ActionExecution
  approval?: ApprovalRequest
  attempts: ActionAttempt[]
  job?: Job
  evidence: EvidenceRecord[]
}

export interface MailboxRollbackOptions {
  actor?: AuditActor
  /**
   * Typed confirmation that must equal the canonical mailbox address. It is
   * re-checked here in addition to the route's Tier-3 gate, so a mailbox can
   * never be destroyed without the exact address.
   */
  typedConfirmation?: string
}

type AliasActionView = OrganizationActionView
type DomainActionView = OrganizationActionView
type MailboxActionView = OrganizationActionView

interface ResourceFlow<Request> {
  actionName: string
  jobName: string
  kind: EngineResourceKind
  collector: string
  /** Raw resource key (alias address / domain name) from validated parameters. */
  keyOf(parameters: Record<string, unknown>): string | undefined
  parametersOf(request: Request): Record<string, unknown>
  derivedKey(request: Request): string
  /**
   * When true, every non-settled job invocation must hold an exclusive broker
   * claim before running, including a claim that represents "no secret". This
   * stops a concurrent duplicate from running the job under another request's
   * claim.
   */
  usesSecretBroker?: boolean
}

const ALIAS_FLOW: ResourceFlow<ValidatedAliasRequest> = {
  actionName: ALIAS_ACTION_NAME,
  jobName: ALIAS_JOB_NAME,
  kind: 'alias',
  collector: 'organization-core:organization.alias',
  keyOf: (parameters) => (typeof parameters.address === 'string' ? parameters.address : undefined),
  parametersOf: (request) => ({
    address: request.address,
    target: request.target,
    ...(request.description === undefined ? {} : { description: request.description }),
  }),
  derivedKey: derivedAliasIdempotencyKey,
}

const DOMAIN_FLOW: ResourceFlow<ValidatedDomainRequest> = {
  actionName: DOMAIN_ACTION_NAME,
  jobName: DOMAIN_JOB_NAME,
  kind: 'domain',
  collector: 'organization-core:organization.domain',
  keyOf: (parameters) => (typeof parameters.name === 'string' ? parameters.name : undefined),
  parametersOf: (request) => ({
    name: request.name,
    ...(request.description === undefined ? {} : { description: request.description }),
    ...(request.dkimSigning === undefined ? {} : { dkimSigning: request.dkimSigning }),
  }),
  derivedKey: derivedDomainIdempotencyKey,
}

const MAILBOX_FLOW: ResourceFlow<ValidatedMailboxRequest> = {
  actionName: MAILBOX_ACTION_NAME,
  jobName: MAILBOX_JOB_NAME,
  kind: 'mailbox',
  collector: 'organization-core:organization.mailbox',
  keyOf: (parameters) => (typeof parameters.email === 'string' ? parameters.email : undefined),
  parametersOf: (request) => ({
    email: request.email,
    ...(request.description === undefined ? {} : { description: request.description }),
  }),
  derivedKey: derivedMailboxIdempotencyKey,
  usesSecretBroker: true,
}

/** Drives `apply` for a planned, approved resource action inside a durable job. */
class ProvisionJobHandler implements JobHandlerPort {
  constructor(
    readonly name: string,
    private readonly core: ActionCore,
    private readonly beforeApply?: (actionId: string) => void | Promise<void>,
  ) {}

  async run(job: Job, ctx: JobHandlerContext): Promise<Record<string, unknown>> {
    const actionId = typeof job.payload.actionId === 'string' ? job.payload.actionId : ''
    if (actionId.length === 0) {
      throw new OrganizationError(
        'VALIDATION_FAILED',
        'Provisioning job is missing its action id',
        {
          details: { jobId: job.id },
        },
      )
    }
    // Fail closed before the durable dispatch fence when the action needs a
    // secret this process does not hold: no attempt, no mutation, resumable.
    // Reconciliation of an interrupted dispatch also runs here, before the fence.
    await this.beforeApply?.(actionId)
    const applyKey = typeof job.payload.applyKey === 'string' ? job.payload.applyKey : undefined
    ctx.reportProgress({ current: 1, total: 2, percentage: 50, message: 'Applying mutation' })
    const action = await this.core.actionService.applyAction(actionId, {
      ...(applyKey === undefined ? {} : { idempotencyKey: applyKey }),
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    })
    ctx.reportProgress({
      current: 2,
      total: 2,
      percentage: 100,
      message: `Action ${action.status}`,
    })
    return {
      actionId,
      status: action.status,
      verificationPassed: action.verification?.passed === true,
    }
  }
}

/**
 * Organization/admin actions over the shared action ledger.
 *
 * The lifecycle `discover → plan → diff → approve → apply → verify → result →
 * rollback` is realized by the action ledger; this service composes the
 * create-only reversible executors, enforces the Tier 1 confirmation at the
 * service boundary, and persists the job that owns each mutation so IDs and
 * state survive a restart.
 */
export class OrganizationService {
  private readonly store: OrganizationStore
  private readonly surface: NavinSurface
  /**
   * Request-scoped apply-time secrets. A password lives here only while the
   * request that supplied it is applying its action and is cleared in a
   * `finally`; it is never persisted or serialized.
   */
  private readonly mailboxSecrets = new MailboxSecretBroker()

  constructor(private readonly deps: OrganizationServiceDeps) {
    this.surface = deps.surface ?? 'control'
    this.store = new OrganizationStore(deps.core.db)
    this.store.migrate()

    const executorDeps = {
      engine: deps.engine,
      store: this.store,
      clock: deps.clock,
      secretProvider: (actionId: string) => this.mailboxSecrets.get(actionId),
    }
    if (deps.core.executors.findExecutor(ALIAS_ACTION_NAME) === undefined) {
      deps.core.executors.registerExecutor(createAliasProvisioningExecutor(executorDeps))
    }
    if (deps.core.executors.findExecutor(DOMAIN_ACTION_NAME) === undefined) {
      deps.core.executors.registerExecutor(createDomainProvisioningExecutor(executorDeps))
    }
    if (deps.core.executors.findExecutor(MAILBOX_ACTION_NAME) === undefined) {
      deps.core.executors.registerExecutor(createMailboxProvisioningExecutor(executorDeps))
    }
    if (deps.core.executors.findJobHandler(ALIAS_JOB_NAME) === undefined) {
      deps.core.executors.registerJobHandler(new ProvisionJobHandler(ALIAS_JOB_NAME, deps.core))
    }
    if (deps.core.executors.findJobHandler(DOMAIN_JOB_NAME) === undefined) {
      deps.core.executors.registerJobHandler(new ProvisionJobHandler(DOMAIN_JOB_NAME, deps.core))
    }
    if (deps.core.executors.findJobHandler(MAILBOX_JOB_NAME) === undefined) {
      deps.core.executors.registerJobHandler(
        new ProvisionJobHandler(MAILBOX_JOB_NAME, deps.core, (actionId) =>
          this.prepareMailboxApply(actionId),
        ),
      )
    }
  }

  /** plan → diff, persisted and awaiting approval. No engine mutation is performed. */
  async planAlias(
    input: AliasProvisioningInput,
    options: PlanActionOptions,
  ): Promise<AliasActionView> {
    const request = validateAliasRequest(input)
    this.assertEngineConfigured()
    const key = this.resolveKey(request, options.idempotencyKey, ALIAS_FLOW.derivedKey)
    return this.view(ALIAS_FLOW, (await this.stageAndPlan(ALIAS_FLOW, request, options, key)).id)
  }

  /** plan → diff, persisted and awaiting approval. No engine mutation is performed. */
  async planDomain(
    input: DomainProvisioningInput,
    options: PlanActionOptions,
  ): Promise<DomainActionView> {
    const request = validateDomainRequest(input)
    this.assertEngineConfigured()
    const key = this.resolveKey(request, options.idempotencyKey, DOMAIN_FLOW.derivedKey)
    return this.view(DOMAIN_FLOW, (await this.stageAndPlan(DOMAIN_FLOW, request, options, key)).id)
  }

  /**
   * plan → diff → approve → apply → verify → result. Idempotent per derived or
   * supplied key: a repeated call returns the same action and never issues a
   * duplicate mutation.
   */
  provisionAlias(
    input: AliasProvisioningInput,
    options: ProvisionActionOptions,
  ): Promise<AliasActionView> {
    return this.provision(ALIAS_FLOW, validateAliasRequest(input), options)
  }

  /**
   * plan → diff → approve → apply → verify → result for a domain create.
   * Create-only: a differing pre-existing domain is refused before mutation.
   */
  provisionDomain(
    input: DomainProvisioningInput,
    options: ProvisionActionOptions,
  ): Promise<DomainActionView> {
    return this.provision(DOMAIN_FLOW, validateDomainRequest(input), options)
  }

  getAliasAction(actionId: string): AliasActionView {
    return this.view(ALIAS_FLOW, actionId)
  }

  getDomainAction(actionId: string): DomainActionView {
    return this.view(DOMAIN_FLOW, actionId)
  }

  /** rollback: revert exactly the resource this action created and verify absence. */
  async rollbackAlias(
    actionId: string,
    options: RollbackActionOptions = {},
  ): Promise<AliasActionView> {
    return this.rollback(ALIAS_FLOW, actionId, options)
  }

  async rollbackDomain(
    actionId: string,
    options: RollbackActionOptions = {},
  ): Promise<DomainActionView> {
    return this.rollback(DOMAIN_FLOW, actionId, options)
  }

  /** plan → diff, persisted and awaiting approval. No engine mutation. */
  async planMailbox(
    input: MailboxProvisioningInput,
    options: PlanActionOptions,
  ): Promise<MailboxActionView> {
    const request = validateMailboxRequest(input)
    this.assertEngineConfigured()
    const key = this.resolveKey(request, options.idempotencyKey, MAILBOX_FLOW.derivedKey)
    return this.view(
      MAILBOX_FLOW,
      (await this.stageAndPlan(MAILBOX_FLOW, request, options, key)).id,
    )
  }

  /**
   * plan → diff → approve → apply → verify → result for a mailbox create.
   *
   * Create-only: a differing pre-existing mailbox is refused before mutation.
   * The password is an apply-time secret and never reaches parameters, the
   * idempotency payload, the job, the plan, evidence or logs; without it the
   * action fails closed (needs_attention / secret required) with zero mutation
   * and stays resumable by the same request and idempotency key.
   */
  provisionMailbox(
    input: MailboxProvisioningInput,
    options: ProvisionActionOptions,
  ): Promise<MailboxActionView> {
    const request = validateMailboxRequest(input)
    const password =
      input.password === undefined ? undefined : validateMailboxPassword(input.password)
    return this.provision(MAILBOX_FLOW, request, options, password)
  }

  getMailboxAction(actionId: string): MailboxActionView {
    return this.view(MAILBOX_FLOW, actionId)
  }

  /**
   * Canonical mailbox address that a destructive rollback must echo back as its
   * typed confirmation. Rejected for a foreign action id.
   */
  mailboxRollbackTarget(actionId: string): string {
    const action = this.requireAction(MAILBOX_FLOW, actionId)
    const email = MAILBOX_FLOW.keyOf(action.parameters)
    if (email === undefined) {
      throw new OrganizationError('INTERNAL_ERROR', 'Mailbox action has no target address', {
        details: { actionId },
      })
    }
    return email
  }

  /**
   * Destructive rollback: destroys exactly the mailbox this action created and
   * proves absence. The typed confirmation must equal the canonical address;
   * the Tier-3 recent-auth gate is enforced by the control surface.
   */
  async rollbackMailbox(
    actionId: string,
    options: MailboxRollbackOptions = {},
  ): Promise<MailboxActionView> {
    const action = this.requireAction(MAILBOX_FLOW, actionId)
    const email = MAILBOX_FLOW.keyOf(action.parameters)
    if (email === undefined) {
      throw new OrganizationError('INTERNAL_ERROR', 'Mailbox action has no target address', {
        details: { actionId },
      })
    }
    if (options.typedConfirmation === undefined || options.typedConfirmation !== email) {
      throw new OrganizationError(
        'APPROVAL_REQUIRED',
        'Mailbox rollback requires the exact mailbox address as typed confirmation',
        { details: { actionId, riskTier: 3 } },
      )
    }
    return this.rollback(MAILBOX_FLOW, actionId, {
      ...(options.actor === undefined ? {} : { actor: options.actor }),
    })
  }

  private async provision<Request>(
    flow: ResourceFlow<Request>,
    request: Request,
    options: ProvisionActionOptions,
    secret?: string,
  ): Promise<OrganizationActionView> {
    if (options.confirm !== true) {
      throw new OrganizationError(
        'APPROVAL_REQUIRED',
        'Provisioning requires explicit confirmation; non-interactive callers fail closed',
        { details: { riskTier: 1 } },
      )
    }
    this.assertEngineConfigured()
    const key = this.resolveKey(request, options.idempotencyKey, flow.derivedKey)

    let action = await this.stageAndPlan(flow, request, options, key)
    this.assertCreateOnly(flow, action)
    action = this.ensureApproved(action, options)
    if (this.isSettled(action.status)) {
      // Durable repair: a crash after the action completed but before evidence
      // was written would otherwise leave a completed action permanently without
      // evidence. Appending is idempotent per action id, so a retry repairs it.
      if (action.status === 'completed') {
        this.appendSuccessEvidence(flow, action)
      }
      return this.view(flow, action.id)
    }

    const job = this.ensureJob(flow, action.id, request, key)
    if (job.status !== 'completed') {
      // Every non-settled mailbox job takes an exclusive claim before running,
      // including a claim that represents "no secret". A concurrent duplicate —
      // with or without a password — therefore fails closed with a generic
      // conflict instead of running the same job under another request's claim.
      // The release is owner-token checked in a `finally`, so it can never clear
      // another claimant's secret or outlive this apply.
      const claim =
        flow.usesSecretBroker === true ? this.mailboxSecrets.claim(action.id, secret) : undefined
      try {
        await this.deps.core.jobRunner.run(job.id, {
          ...(options.actor === undefined ? {} : { actor: options.actor }),
        })
      } finally {
        if (claim !== undefined) {
          this.mailboxSecrets.release(claim)
        }
      }
    }
    action = this.deps.core.actions.require(action.id)
    this.appendSuccessEvidence(flow, action)
    return this.view(flow, action.id)
  }

  /**
   * Pre-apply gate for a mailbox job. It runs before the durable dispatch fence,
   * so neither a missing secret nor reconciliation can mutate the engine by
   * accident.
   */
  private async prepareMailboxApply(actionId: string): Promise<void> {
    this.requireMailboxSecret(actionId)
    await this.reconcileUnknownMailbox(actionId)
  }

  /**
   * Fails a mailbox job closed when the apply needs a password this process does
   * not hold (for example after a restart). No attempt is reserved and no engine
   * mutation is possible; the action stays approved and the same request with the
   * password resumes it.
   */
  private requireMailboxSecret(actionId: string): void {
    const step = this.store.getPlan(actionId)?.enginePlan.steps[0]
    if (step === undefined || step.kind !== 'mailbox' || step.op === 'noop') {
      return
    }
    if (this.mailboxSecrets.get(actionId) === undefined) {
      throw new ActionCoreError(
        'ACTION_BLOCKED',
        'Mailbox password is required to apply this action and is not available; resubmit with the password',
        { details: { needsAttention: true, secretRequired: true } },
      )
    }
  }

  /**
   * Resolves a mailbox action left with an unknown outcome by a process loss
   * (dispatched attempt, action failed with needsAttention) by re-reading the
   * engine through the executor's production verifier. A verified mailbox is
   * completed; otherwise the action stays failed with needsAttention. This only
   * runs for the interrupted state, so a normal apply is untouched.
   */
  private async reconcileUnknownMailbox(actionId: string): Promise<void> {
    const action = this.deps.core.actions.require(actionId)
    if (action.status !== 'failed' || action.error?.details?.needsAttention !== true) {
      return
    }
    const attempt = this.deps.core.actionService.getAttempts(actionId).at(-1)
    if (attempt?.status !== 'unknown') {
      return
    }
    await this.deps.core.actionService.reconcileUnknownAction(actionId)
  }

  private async rollback<Request>(
    flow: ResourceFlow<Request>,
    actionId: string,
    options: RollbackActionOptions,
  ): Promise<OrganizationActionView> {
    // Ownership is checked before any rollback so a foreign action id can never
    // be reverted through this resource's API.
    this.requireAction(flow, actionId)
    await this.deps.core.actionService.rollbackAction(actionId, {
      ...(options.actor === undefined ? {} : { actor: options.actor }),
    })
    return this.view(flow, actionId)
  }

  /**
   * Resolves an action only when it belongs to this resource's namespace. A
   * foreign action id (any other `name`) is rejected so it is neither presented
   * nor mutated through this resource's API.
   */
  private requireAction<Request>(flow: ResourceFlow<Request>, actionId: string): ActionExecution {
    const action = this.deps.core.actions.require(actionId)
    if (action.name !== flow.actionName) {
      throw new OrganizationError(
        'NOT_FOUND',
        `Action ${actionId} is not an organization ${flow.kind} action`,
        { details: { actionId, name: action.name } },
      )
    }
    return action
  }

  private async stageAndPlan<Request>(
    flow: ResourceFlow<Request>,
    request: Request,
    options: PlanActionOptions,
    key: string,
  ): Promise<ActionExecution> {
    const staged = this.deps.core.actionService.stageAction({
      name: flow.actionName,
      surface: this.surface,
      riskTier: 1,
      parameters: flow.parametersOf(request),
      requestedBy: options.requestedBy,
      canRollback: true,
      idempotencyKey: key,
      ...(options.actor === undefined ? {} : { actor: options.actor }),
    })
    if (staged.action.status !== 'staged') {
      return staged.action
    }
    return this.deps.core.actionService.planAction(staged.action.id, {})
  }

  /**
   * Create-only safety enforced before approval, job creation, attempt
   * reservation or dispatch: a plan whose observed state already exists but
   * differs (`op === 'update'`) is refused, leaving the action `planned` with no
   * attempt, no job, no approval decision and no upstream mutation. The engine
   * executor repeats this guard as defense in depth.
   */
  private assertCreateOnly<Request>(flow: ResourceFlow<Request>, action: ActionExecution): void {
    const step = this.store.getPlan(action.id)?.enginePlan.steps[0]
    if (step?.op !== 'update') {
      return
    }
    throw new OrganizationError(
      'PRECONDITION_FAILED',
      `Refusing to update a pre-existing ${flow.kind} this create action does not own`,
      {
        details: {
          actionId: action.id,
          kind: flow.kind,
          target: step.target,
          observed: step.observed,
        },
      },
    )
  }

  private ensureApproved(action: ActionExecution, options: PlanActionOptions): ActionExecution {
    const approvals = this.deps.core.approvals.listByAction(action.id)
    const approved = approvals.find(
      (candidate) => candidate.status === 'approved' && candidate.decision?.decision === 'approved',
    )
    if (approved !== undefined) {
      return action
    }
    const pending = approvals.find((candidate) => candidate.status === 'pending')

    let approval: ApprovalRequest
    if (action.status === 'staged' || action.status === 'planned') {
      approval = pending ?? this.deps.core.actionService.requestApproval(action.id)
    } else if (pending !== undefined) {
      approval = pending
    } else {
      throw new OrganizationError(
        'APPROVAL_REQUIRED',
        `Action ${action.id} is ${action.status} and cannot be approved for apply`,
        { details: { actionId: action.id, status: action.status } },
      )
    }

    this.deps.core.actionService.decideApproval(approval.id, {
      decidedBy: options.requestedBy,
      decision: 'approved',
      stepUpVerified: false,
      ...(options.actor === undefined ? {} : { actor: options.actor }),
    })
    return this.deps.core.actions.require(action.id)
  }

  private ensureJob<Request>(
    flow: ResourceFlow<Request>,
    actionId: string,
    request: Request,
    key: string,
  ): Job {
    const existing = this.store.getOperation(actionId)
    if (existing !== undefined) {
      const job = this.deps.core.jobs.get(existing.jobId)
      if (job !== undefined) {
        return job
      }
    }
    const job = this.deps.core.jobRunner.createJob({
      name: flow.jobName,
      surface: this.surface,
      payload: {
        actionId,
        ...flow.parametersOf(request),
        applyKey: `${key}.apply`,
      },
      cancellable: false,
      resumable: true,
      idempotencyKey: `${key}.job`,
    })
    const resourceKey = flow.keyOf(flow.parametersOf(request)) ?? ''
    this.store.linkJob({
      actionId,
      jobId: job.id,
      resourceKind: flow.kind,
      resourceKey,
      createdAt: this.deps.clock().toISOString(),
    })
    return job
  }

  private appendSuccessEvidence<Request>(
    flow: ResourceFlow<Request>,
    action: ActionExecution,
  ): void {
    if (action.status !== 'completed') {
      return
    }
    const target = this.evidenceTarget(flow, action.parameters)
    if (target === undefined) {
      return
    }
    // Deduplicate only for this same action id: a distinct later action for the
    // same resource must still record its own evidence.
    if (this.evidenceForAction(action, target).length > 0) {
      return
    }
    const verification = action.verification
    this.deps.core.evidence.append({
      checkType: 'custom_check',
      status: 'passed',
      target,
      collector: flow.collector,
      details: {
        actionId: action.id,
        resourceKey: flow.keyOf(action.parameters),
        command: verification?.command,
        passed: verification?.passed === true,
      },
      // Non-empty observed output from the production verifier; a metadata-only
      // record can never admit a PASS.
      rawOutputRedacted: JSON.stringify(verification?.actual ?? {}),
    })
  }

  /**
   * Returns exactly the evidence rows belonging to one action, paging the
   * target's records until the ledger is exhausted so the result is complete
   * regardless of how many rows other actions have recorded for the same target.
   */
  private evidenceForAction(action: ActionExecution, target: string): EvidenceRecord[] {
    const pageSize = 200
    const matched: EvidenceRecord[] = []
    for (let offset = 0; ; offset += pageSize) {
      const page = this.deps.core.evidence.list({ target, limit: pageSize, offset })
      for (const record of page) {
        if (record.details.actionId === action.id) {
          matched.push(record)
        }
      }
      if (page.length < pageSize) {
        break
      }
    }
    return matched
  }

  private evidenceTarget<Request>(
    flow: ResourceFlow<Request>,
    parameters: Record<string, unknown>,
  ): string | undefined {
    const key = flow.keyOf(parameters)
    return key === undefined ? undefined : `${flow.kind}:${key}`
  }

  private view<Request>(flow: ResourceFlow<Request>, actionId: string): OrganizationActionView {
    const action = this.requireAction(flow, actionId)
    const attempts = this.deps.core.actionService.getAttempts(actionId)
    const approvals = this.deps.core.approvals.listByAction(actionId)
    const approval = approvals[approvals.length - 1]
    const operation = this.store.getOperation(actionId)
    const job = operation === undefined ? undefined : this.deps.core.jobs.get(operation.jobId)
    const target = this.evidenceTarget(flow, action.parameters)
    const evidence = target === undefined ? [] : this.evidenceForAction(action, target)

    return {
      action,
      ...(approval === undefined ? {} : { approval }),
      attempts,
      ...(job === undefined ? {} : { job }),
      evidence,
    }
  }

  private resolveKey<Request>(
    request: Request,
    supplied: string | undefined,
    derived: (request: Request) => string,
  ): string {
    return supplied === undefined ? derived(request) : validateIdempotencyKey(supplied)
  }

  private isSettled(status: ActionExecution['status']): boolean {
    return status === 'completed' || status === 'rolled_back'
  }

  private assertEngineConfigured(): void {
    if (this.deps.engine === null) {
      throw new OrganizationError(
        'SERVICE_UNAVAILABLE',
        'Mail engine is not configured; organization provisioning is unavailable',
        { retryable: true, details: { reason: 'engine_unconfigured' } },
      )
    }
  }
}
