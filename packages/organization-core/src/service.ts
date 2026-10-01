import {
  ActionCore,
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
import type { MailEngineAdapter } from '@navin/engine-core'

import {
  derivedAliasIdempotencyKey,
  validateAliasRequest,
  validateIdempotencyKey,
  type AliasProvisioningInput,
  type ValidatedAliasRequest,
} from './alias.js'
import { OrganizationError } from './errors.js'
import { AliasProvisioningExecutor } from './executor.js'
import { OrganizationStore } from './store.js'

export const ALIAS_ACTION_NAME = 'organization.alias.create'
export const ALIAS_JOB_NAME = 'organization.alias.provision'

export interface OrganizationServiceDeps {
  core: ActionCore
  engine: MailEngineAdapter | null
  clock: Clock
  surface?: NavinSurface
}

export interface PlanAliasOptions {
  requestedBy: string
  idempotencyKey?: string
  actor?: AuditActor
}

export interface ProvisionAliasOptions extends PlanAliasOptions {
  /** Ordinary Tier 1 confirmation. Non-interactive callers fail closed without it. */
  confirm: boolean
}

export interface RollbackAliasOptions {
  actor?: AuditActor
}

export interface AliasActionView {
  action: ActionExecution
  approval?: ApprovalRequest
  attempts: ActionAttempt[]
  job?: Job
  evidence: EvidenceRecord[]
}

/** Drives `apply` for a planned, approved alias action inside a durable job. */
class AliasProvisionJobHandler implements JobHandlerPort {
  readonly name = ALIAS_JOB_NAME

  constructor(private readonly core: ActionCore) {}

  async run(job: Job, ctx: JobHandlerContext): Promise<Record<string, unknown>> {
    const actionId = typeof job.payload.actionId === 'string' ? job.payload.actionId : ''
    if (actionId.length === 0) {
      throw new OrganizationError('VALIDATION_FAILED', 'Alias job is missing its action id', {
        details: { jobId: job.id },
      })
    }
    const applyKey = typeof job.payload.applyKey === 'string' ? job.payload.applyKey : undefined
    ctx.reportProgress({ current: 1, total: 2, percentage: 50, message: 'Applying alias mutation' })
    const action = await this.core.actionService.applyAction(actionId, {
      ...(applyKey === undefined ? {} : { idempotencyKey: applyKey }),
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    })
    ctx.reportProgress({
      current: 2,
      total: 2,
      percentage: 100,
      message: `Alias action ${action.status}`,
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
 * rollback` is realized by the action ledger; this service composes the alias
 * executor, enforces the Tier 1 confirmation at the service boundary, and
 * persists the job that owns each mutation so IDs and state survive a restart.
 */
export class OrganizationService {
  private readonly store: OrganizationStore
  private readonly surface: NavinSurface

  constructor(private readonly deps: OrganizationServiceDeps) {
    this.surface = deps.surface ?? 'control'
    this.store = new OrganizationStore(deps.core.db)
    this.store.migrate()

    if (deps.core.executors.findExecutor(ALIAS_ACTION_NAME) === undefined) {
      deps.core.executors.registerExecutor(
        new AliasProvisioningExecutor({
          engine: deps.engine,
          store: this.store,
          clock: deps.clock,
        }),
      )
    }
    if (deps.core.executors.findJobHandler(ALIAS_JOB_NAME) === undefined) {
      deps.core.executors.registerJobHandler(new AliasProvisionJobHandler(deps.core))
    }
  }

  /** plan → diff, persisted and awaiting approval. No engine mutation is performed. */
  async planAlias(
    input: AliasProvisioningInput,
    options: PlanAliasOptions,
  ): Promise<AliasActionView> {
    const request = validateAliasRequest(input)
    this.assertEngineConfigured()
    const key = this.resolveKey(request, options.idempotencyKey)
    const action = await this.ensurePlanned(request, options, key)
    return this.view(action.id)
  }

  /**
   * plan → diff → approve → apply → verify → result. Idempotent per derived
   * or supplied key: a repeated call returns the same action and never issues a
   * duplicate mutation.
   */
  async provisionAlias(
    input: AliasProvisioningInput,
    options: ProvisionAliasOptions,
  ): Promise<AliasActionView> {
    if (options.confirm !== true) {
      throw new OrganizationError(
        'APPROVAL_REQUIRED',
        'Alias provisioning requires explicit confirmation; non-interactive callers fail closed',
        { details: { riskTier: 1 } },
      )
    }
    const request = validateAliasRequest(input)
    this.assertEngineConfigured()
    const key = this.resolveKey(request, options.idempotencyKey)

    let action = await this.ensurePlanned(request, options, key)
    action = this.ensureApproved(action, options)
    if (this.isSettled(action.status)) {
      // Durable repair: a crash after the action completed but before evidence
      // was written would otherwise leave a completed action permanently without
      // evidence. Appending is idempotent per action id, so a retry repairs it.
      if (action.status === 'completed') {
        this.appendSuccessEvidence(action, request)
      }
      return this.view(action.id)
    }

    const job = this.ensureJob(action.id, request, key)
    if (job.status !== 'completed') {
      await this.deps.core.jobRunner.run(job.id, {
        ...(options.actor === undefined ? {} : { actor: options.actor }),
      })
    }
    action = this.deps.core.actions.require(action.id)
    this.appendSuccessEvidence(action, request)
    return this.view(action.id)
  }

  getAliasAction(actionId: string): AliasActionView {
    this.requireAliasAction(actionId)
    return this.view(actionId)
  }

  /** rollback: revert exactly the alias this action created and verify absence. */
  async rollbackAlias(
    actionId: string,
    options: RollbackAliasOptions = {},
  ): Promise<AliasActionView> {
    // Ownership is checked before any rollback so a foreign action id can never
    // be reverted through the organization API.
    this.requireAliasAction(actionId)
    await this.deps.core.actionService.rollbackAction(actionId, {
      ...(options.actor === undefined ? {} : { actor: options.actor }),
    })
    return this.view(actionId)
  }

  /**
   * Resolves an action only when it belongs to this service's namespace. A
   * foreign action id (any `name` other than the alias action) is rejected so it
   * is neither presented nor mutated through the organization API.
   */
  private requireAliasAction(actionId: string): ActionExecution {
    const action = this.deps.core.actions.require(actionId)
    if (action.name !== ALIAS_ACTION_NAME) {
      throw new OrganizationError(
        'NOT_FOUND',
        `Action ${actionId} is not an organization alias action`,
        { details: { actionId, name: action.name } },
      )
    }
    return action
  }

  private async ensurePlanned(
    request: ValidatedAliasRequest,
    options: PlanAliasOptions,
    key: string,
  ): Promise<ActionExecution> {
    const staged = this.deps.core.actionService.stageAction({
      name: ALIAS_ACTION_NAME,
      surface: this.surface,
      riskTier: 1,
      parameters: this.parametersFor(request),
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

  private ensureApproved(action: ActionExecution, options: PlanAliasOptions): ActionExecution {
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

  private ensureJob(actionId: string, request: ValidatedAliasRequest, key: string): Job {
    const existing = this.store.getOperation(actionId)
    if (existing !== undefined) {
      const job = this.deps.core.jobs.get(existing.jobId)
      if (job !== undefined) {
        return job
      }
    }
    const job = this.deps.core.jobRunner.createJob({
      name: ALIAS_JOB_NAME,
      surface: this.surface,
      payload: {
        actionId,
        address: request.address,
        target: request.target,
        applyKey: `${key}.apply`,
      },
      cancellable: false,
      resumable: true,
      idempotencyKey: `${key}.job`,
    })
    this.store.linkJob({
      actionId,
      jobId: job.id,
      request,
      createdAt: this.deps.clock().toISOString(),
    })
    return job
  }

  private appendSuccessEvidence(action: ActionExecution, request: ValidatedAliasRequest): void {
    if (action.status !== 'completed') {
      return
    }
    // Deduplicate only for this same action id: a distinct later action for the
    // same alias must still record its own evidence.
    if (this.evidenceForAction(action, request.address).length > 0) {
      return
    }
    const verification = action.verification
    this.deps.core.evidence.append({
      checkType: 'custom_check',
      status: 'passed',
      target: `alias:${request.address}`,
      collector: 'organization-core:organization.alias',
      details: {
        actionId: action.id,
        address: request.address,
        command: verification?.command,
        passed: verification?.passed === true,
      },
      // Non-empty observed output from the production verifier; a metadata-only
      // record can never admit a PASS.
      rawOutputRedacted: JSON.stringify(verification?.actual ?? { address: request.address }),
    })
  }

  /**
   * Returns exactly the evidence rows belonging to one action, paging the
   * target's records until the ledger is exhausted so the result is complete
   * regardless of how many rows other actions have recorded for the same alias.
   */
  private evidenceForAction(action: ActionExecution, address: string): EvidenceRecord[] {
    const target = `alias:${address}`
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

  private view(actionId: string): AliasActionView {
    const action = this.requireAliasAction(actionId)
    const attempts = this.deps.core.actionService.getAttempts(actionId)
    const approvals = this.deps.core.approvals.listByAction(actionId)
    const approval = approvals[approvals.length - 1]
    const operation = this.store.getOperation(actionId)
    const job = operation === undefined ? undefined : this.deps.core.jobs.get(operation.jobId)
    const address =
      typeof action.parameters.address === 'string' ? action.parameters.address : undefined
    const evidence = address === undefined ? [] : this.evidenceForAction(action, address)

    return {
      action,
      ...(approval === undefined ? {} : { approval }),
      attempts,
      ...(job === undefined ? {} : { job }),
      evidence,
    }
  }

  private parametersFor(request: ValidatedAliasRequest): Record<string, unknown> {
    return {
      address: request.address,
      target: request.target,
      ...(request.description === undefined ? {} : { description: request.description }),
    }
  }

  private resolveKey(request: ValidatedAliasRequest, supplied?: string): string {
    return supplied === undefined
      ? derivedAliasIdempotencyKey(request)
      : validateIdempotencyKey(supplied)
  }

  private isSettled(status: ActionExecution['status']): boolean {
    return status === 'completed' || status === 'rolled_back'
  }

  private assertEngineConfigured(): void {
    if (this.deps.engine === null) {
      throw new OrganizationError(
        'SERVICE_UNAVAILABLE',
        'Mail engine is not configured; alias provisioning is unavailable',
        { retryable: true, details: { reason: 'engine_unconfigured' } },
      )
    }
  }
}
