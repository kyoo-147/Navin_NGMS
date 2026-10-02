import {
  ActionExecutionSchema,
  EvidenceRecordSchema,
  JobSchema,
  SessionPrincipalSchema,
  SetupSessionSchema,
  type ActionExecution,
  type AuditRecord,
  type EvidenceRecord,
  type Job,
  type SessionPrincipal,
  type SetupSession,
} from '@navin/contracts'
import { BaseApiClient, type RequestOptions } from './base-client.js'
import type { ApiClientOptions } from './options.js'
import { routes } from './routes.js'
import {
  AliasActionViewSchema,
  AliasPlanRequestSchema,
  AliasProvisionRequestSchema,
  AuditRecordListSchema,
  DomainActionViewSchema,
  DomainPlanRequestSchema,
  DomainProvisionRequestSchema,
  HealthResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  MailboxActionViewSchema,
  MailboxPlanRequestSchema,
  MailboxProvisionRequestSchema,
  MailboxRollbackRequestSchema,
  NavinEventSchema,
  SetupSessionCreateRequestSchema,
  SetupSessionListSchema,
  type AliasActionView,
  type AliasPlanRequest,
  type AliasProvisionRequest,
  type DomainActionView,
  type DomainPlanRequest,
  type DomainProvisionRequest,
  type HealthResponse,
  type LoginRequest,
  type LoginResponse,
  type MailboxActionView,
  type MailboxPlanRequest,
  type MailboxProvisionRequest,
  type MailboxRollbackRequest,
  type SetupSessionCreateRequest,
} from './schemas.js'
import type { SseRequestOptions, SseSubscription } from './sse.js'

export type ControlSurface = 'control' | 'cli'

export interface ControlApiClientOptions extends Omit<ApiClientOptions, 'surface'> {
  surface?: ControlSurface
}

export type ControlEventOptions = Omit<
  SseRequestOptions<typeof NavinEventSchema>,
  'path' | 'schema'
>

/**
 * Control-surface client for Control Web/Desktop (`control`) and the CLI (`cli`). Authenticates
 * with the Control relying party, typically a scoped bearer token.
 */
export class ControlApiClient extends BaseApiClient {
  constructor(options: ControlApiClientOptions) {
    super({ ...options, surface: options.surface ?? 'control' })
  }

  health(options?: RequestOptions): Promise<HealthResponse> {
    return this.send({
      method: 'GET',
      path: routes.health,
      responseSchema: HealthResponseSchema,
      ...options,
    })
  }

  login(request: LoginRequest, options?: RequestOptions): Promise<LoginResponse> {
    return this.send({
      method: 'POST',
      path: routes.auth.login,
      body: request,
      requestSchema: LoginRequestSchema,
      responseSchema: LoginResponseSchema,
      ...options,
    })
  }

  whoami(options?: RequestOptions): Promise<SessionPrincipal> {
    return this.send({
      method: 'GET',
      path: routes.auth.session,
      responseSchema: SessionPrincipalSchema,
      ...options,
    })
  }

  async listSetupSessions(options?: RequestOptions): Promise<SetupSession[]> {
    const result = await this.send({
      method: 'GET',
      path: routes.setup.sessions,
      responseSchema: SetupSessionListSchema,
      ...options,
    })
    return result.sessions
  }

  getSetupSession(sessionId: string, options?: RequestOptions): Promise<SetupSession> {
    return this.send({
      method: 'GET',
      path: routes.setup.session(sessionId),
      responseSchema: SetupSessionSchema,
      ...options,
    })
  }

  createSetupSession(
    request: SetupSessionCreateRequest,
    options?: RequestOptions,
  ): Promise<SetupSession> {
    return this.send({
      method: 'POST',
      path: routes.setup.sessions,
      body: request,
      requestSchema: SetupSessionCreateRequestSchema,
      responseSchema: SetupSessionSchema,
      ...options,
    })
  }

  resumeSetupSession(sessionId: string, options?: RequestOptions): Promise<SetupSession> {
    return this.send({
      method: 'POST',
      path: routes.setup.resume(sessionId),
      responseSchema: SetupSessionSchema,
      ...options,
    })
  }

  getAction(actionId: string, options?: RequestOptions): Promise<ActionExecution> {
    return this.send({
      method: 'GET',
      path: routes.control.action(actionId),
      responseSchema: ActionExecutionSchema,
      ...options,
    })
  }

  getJob(jobId: string, options?: RequestOptions): Promise<Job> {
    return this.send({
      method: 'GET',
      path: routes.control.job(jobId),
      responseSchema: JobSchema,
      ...options,
    })
  }

  cancelJob(jobId: string, options?: RequestOptions): Promise<Job> {
    return this.send({
      method: 'POST',
      path: routes.control.cancelJob(jobId),
      responseSchema: JobSchema,
      ...options,
    })
  }

  async listAudit(options?: RequestOptions): Promise<AuditRecord[]> {
    const result = await this.send({
      method: 'GET',
      path: routes.control.audit,
      responseSchema: AuditRecordListSchema,
      ...options,
    })
    return result.records
  }

  getEvidence(evidenceId: string, options?: RequestOptions): Promise<EvidenceRecord> {
    return this.send({
      method: 'GET',
      path: routes.control.evidence(evidenceId),
      responseSchema: EvidenceRecordSchema,
      ...options,
    })
  }

  /** Tier 1 organization action: plan + diff only, no engine mutation. */
  planAlias(request: AliasPlanRequest, options?: RequestOptions): Promise<AliasActionView> {
    return this.send({
      method: 'POST',
      path: routes.control.organization.planAlias,
      body: request,
      requestSchema: AliasPlanRequestSchema,
      responseSchema: AliasActionViewSchema,
      ...options,
    })
  }

  /** Tier 1 organization action: plan → approve → apply → verify → result. */
  provisionAlias(
    request: AliasProvisionRequest,
    options?: RequestOptions,
  ): Promise<AliasActionView> {
    return this.send({
      method: 'POST',
      path: routes.control.organization.aliases,
      body: request,
      requestSchema: AliasProvisionRequestSchema,
      responseSchema: AliasActionViewSchema,
      ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
      ...options,
    })
  }

  getAliasAction(actionId: string, options?: RequestOptions): Promise<AliasActionView> {
    return this.send({
      method: 'GET',
      path: routes.control.organization.aliasAction(actionId),
      responseSchema: AliasActionViewSchema,
      ...options,
    })
  }

  rollbackAlias(actionId: string, options?: RequestOptions): Promise<AliasActionView> {
    return this.send({
      method: 'POST',
      path: routes.control.organization.rollbackAlias(actionId),
      responseSchema: AliasActionViewSchema,
      ...options,
    })
  }

  /** Tier 1 organization action: plan + exact diff only, no engine mutation. */
  planDomain(request: DomainPlanRequest, options?: RequestOptions): Promise<DomainActionView> {
    return this.send({
      method: 'POST',
      path: routes.control.organization.planDomain,
      body: request,
      requestSchema: DomainPlanRequestSchema,
      responseSchema: DomainActionViewSchema,
      ...options,
    })
  }

  /** Tier 1 organization action: plan → approve → apply → verify → result. */
  provisionDomain(
    request: DomainProvisionRequest,
    options?: RequestOptions,
  ): Promise<DomainActionView> {
    return this.send({
      method: 'POST',
      path: routes.control.organization.domains,
      body: request,
      requestSchema: DomainProvisionRequestSchema,
      responseSchema: DomainActionViewSchema,
      ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
      ...options,
    })
  }

  getDomainAction(actionId: string, options?: RequestOptions): Promise<DomainActionView> {
    return this.send({
      method: 'GET',
      path: routes.control.organization.domainAction(actionId),
      responseSchema: DomainActionViewSchema,
      ...options,
    })
  }

  rollbackDomain(actionId: string, options?: RequestOptions): Promise<DomainActionView> {
    return this.send({
      method: 'POST',
      path: routes.control.organization.rollbackDomain(actionId),
      responseSchema: DomainActionViewSchema,
      ...options,
    })
  }

  /** Tier 1 organization action: plan + exact diff only, no engine mutation. */
  planMailbox(request: MailboxPlanRequest, options?: RequestOptions): Promise<MailboxActionView> {
    return this.send({
      method: 'POST',
      path: routes.control.organization.planMailbox,
      body: request,
      requestSchema: MailboxPlanRequestSchema,
      responseSchema: MailboxActionViewSchema,
      ...options,
    })
  }

  /**
   * Tier 1 organization action: plan → approve → apply → verify → result.
   *
   * The password is an apply-time secret carried in the request body only; it
   * is never placed in the URL and is excluded from the idempotency key.
   */
  provisionMailbox(
    request: MailboxProvisionRequest,
    options?: RequestOptions,
  ): Promise<MailboxActionView> {
    return this.send({
      method: 'POST',
      path: routes.control.organization.mailboxes,
      body: request,
      requestSchema: MailboxProvisionRequestSchema,
      responseSchema: MailboxActionViewSchema,
      ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
      ...options,
    })
  }

  getMailboxAction(actionId: string, options?: RequestOptions): Promise<MailboxActionView> {
    return this.send({
      method: 'GET',
      path: routes.control.organization.mailboxAction(actionId),
      responseSchema: MailboxActionViewSchema,
      ...options,
    })
  }

  /**
   * Destructive rollback. The caller must echo the canonical mailbox address as
   * `confirmation`; the daemon additionally requires a recent Tier-3 step-up.
   */
  rollbackMailbox(
    actionId: string,
    request: MailboxRollbackRequest = {},
    options?: RequestOptions,
  ): Promise<MailboxActionView> {
    return this.send({
      method: 'POST',
      path: routes.control.organization.rollbackMailbox(actionId),
      body: request,
      requestSchema: MailboxRollbackRequestSchema,
      responseSchema: MailboxActionViewSchema,
      ...options,
    })
  }

  events(options: ControlEventOptions): SseSubscription {
    return this.stream({ path: routes.events, schema: NavinEventSchema, ...options })
  }
}
