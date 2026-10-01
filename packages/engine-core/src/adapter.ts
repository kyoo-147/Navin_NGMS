import type { EngineNavinErrorCode } from './errors.js'
import type { EnginePlan } from './plan.js'
import type {
  AliasSpec,
  DomainSpec,
  EngineAliasRecord,
  EngineDomainRecord,
  EngineMailboxRecord,
  MailboxSpec,
} from './resources.js'

export interface EngineProtocolSupport {
  jmap: boolean
  imap: boolean
  pop3: boolean
  smtpSubmission: boolean
  lmtp: boolean
  manageSieve: boolean
  caldav: boolean
  carddav: boolean
}

export interface EngineFeatureSupport {
  pushNotifications: boolean
  serverSideSearch: boolean
  fullTextIndexing: boolean
  storageQuota: boolean
  aliases: boolean
  distributionGroups: boolean
  dkimSigning: boolean
  tlsEnforcement: boolean
  adminApi: boolean
}

export interface EngineLimits {
  maxMessageSizeBytes?: number
  maxRecipientsPerMessage?: number
  maxAttachmentSizeBytes?: number
}

export interface EngineConnection {
  endpoint: string
  secure: boolean
  authMethods: string[]
}

/**
 * Structural mirror of the frozen `EngineAdapterDescriptor` from `@navin/contracts`.
 * Contract conformance is asserted in tests rather than imported, so this package
 * stays dependency-free and the workspace lockfile is untouched.
 */
export interface EngineDescriptor {
  engineId: string
  displayName: string
  version: string
  protocols: EngineProtocolSupport
  features: EngineFeatureSupport
  limits?: EngineLimits
  connection?: EngineConnection
}

export interface EngineCallOptions {
  signal?: AbortSignal
  timeoutMs?: number
  requestId?: string
}

export interface EngineApplyOptions extends EngineCallOptions {
  idempotencyKey?: string
  rollbackOnFailure?: boolean
  /**
   * Per-step secret payloads merged into the mutation at apply time only.
   * Keeping them out of `EnginePlan` prevents credentials from reaching diffs,
   * evidence records or logs.
   */
  secrets?: Record<string, Record<string, unknown>>
}

export interface EngineHealthCheck {
  name: string
  passed: boolean
  detail?: string
}

export interface EngineHealthReport {
  ok: boolean
  status: string
  observedAt: string
  latencyMs: number
  checks: EngineHealthCheck[]
}

export interface EngineVersionReport {
  engineId: string
  product?: string
  version: string
  build?: string
  observedAt: string
}

export interface EngineDiscoveryReport {
  engine: EngineDescriptor
  endpoint: string
  secure: boolean
  observedAt: string
  domains: EngineDomainRecord[]
  mailboxes: EngineMailboxRecord[]
  aliases: EngineAliasRecord[]
  counts: { domains: number; mailboxes: number; aliases: number }
  warnings: string[]
}

export type EngineApplyStepStatus = 'applied' | 'skipped' | 'failed'

export interface EngineStepError {
  code: EngineNavinErrorCode
  message: string
}

export interface EngineApplyStepResult {
  stepId: string
  kind: string
  op: string
  status: EngineApplyStepStatus
  resourceId?: string
  error?: EngineStepError
}

export interface EngineApplyResult {
  planId: string
  appliedAt: string
  ok: boolean
  rolledBack: boolean
  steps: EngineApplyStepResult[]
  appliedResourceIds: Record<string, string>
}

export interface EngineVerifyCheck {
  stepId: string
  command: string
  expected: Record<string, unknown>
  actual?: Record<string, unknown>
  passed: boolean
  detail?: string
}

export interface EngineVerifyResult {
  planId: string
  verifiedAt: string
  passed: boolean
  checks: EngineVerifyCheck[]
}

export type EngineRollbackAction = 'reverted' | 'destroyed' | 'skipped' | 'failed'

export interface EngineRollbackStepResult {
  stepId: string
  action: EngineRollbackAction
  resourceId?: string
  error?: EngineStepError
}

export interface EngineRollbackResult {
  planId: string
  rolledBackAt: string
  passed: boolean
  steps: EngineRollbackStepResult[]
}

export interface MailEngineAdapter {
  readonly descriptor: EngineDescriptor
  health(options?: EngineCallOptions): Promise<EngineHealthReport>
  version(options?: EngineCallOptions): Promise<EngineVersionReport>
  discover(options?: EngineCallOptions): Promise<EngineDiscoveryReport>
  planDomain(spec: DomainSpec, options?: EngineCallOptions): Promise<EnginePlan>
  planMailbox(spec: MailboxSpec, options?: EngineCallOptions): Promise<EnginePlan>
  planAlias(spec: AliasSpec, options?: EngineCallOptions): Promise<EnginePlan>
  apply(plan: EnginePlan, options?: EngineApplyOptions): Promise<EngineApplyResult>
  verify(plan: EnginePlan, options?: EngineCallOptions): Promise<EngineVerifyResult>
  rollback(plan: EnginePlan, options?: EngineCallOptions): Promise<EngineRollbackResult>
}
