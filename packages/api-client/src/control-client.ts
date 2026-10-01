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
  AuditRecordListSchema,
  HealthResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  NavinEventSchema,
  SetupSessionCreateRequestSchema,
  SetupSessionListSchema,
  type HealthResponse,
  type LoginRequest,
  type LoginResponse,
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

  events(options: ControlEventOptions): SseSubscription {
    return this.stream({ path: routes.events, schema: NavinEventSchema, ...options })
  }
}
