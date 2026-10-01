import type {
  EngineApplyOptions,
  EngineApplyResult,
  EngineApplyStepResult,
  EngineCallOptions,
  EngineDescriptor,
  EngineDiscoveryReport,
  EngineFeatureSupport,
  EngineHealthCheck,
  EngineHealthReport,
  EngineLimits,
  EngineProtocolSupport,
  EngineRollbackResult,
  EngineRollbackStepResult,
  EngineStepError,
  EngineVerifyCheck,
  EngineVerifyResult,
  EngineVersionReport,
  MailEngineAdapter,
} from '../adapter.js'
import { EngineError, normalizeEngineError } from '../errors.js'
import type { EnginePlan, EnginePlanStep } from '../plan.js'
import { buildPlan, changesAreSatisfied, stableStringify } from '../plan.js'
import type { AliasSpec, DomainSpec, MailboxSpec } from '../resources.js'
import {
  aliasSpecToDesired,
  domainSpecToDesired,
  mailboxSpecToDesired,
  normalizeDomainName,
  parseEmailAddress,
} from '../resources.js'
import type { AuthProvider, FetchLike, RetryPolicy, TransportCallOptions } from '../transport.js'
import { BasicAuth, BearerTokenAuth, HttpTransport } from '../transport.js'
import { StalwartAdminClient } from './client.js'
import {
  stalwartAccountToManaged,
  stalwartAliasToManaged,
  stalwartDomainToManaged,
  toAliasRecord,
  toDomainRecord,
  toMailboxRecord,
} from './mapper.js'
import { DEFAULT_STALWART_PROFILE, type StalwartProtocolProfile } from './profile.js'
import type { StalwartVersionInfo } from './wire.js'

const STALWART_PROTOCOLS: EngineProtocolSupport = {
  jmap: true,
  imap: true,
  pop3: false,
  smtpSubmission: true,
  lmtp: false,
  manageSieve: true,
  caldav: true,
  carddav: true,
}

const STALWART_FEATURES: EngineFeatureSupport = {
  pushNotifications: true,
  serverSideSearch: true,
  fullTextIndexing: true,
  storageQuota: true,
  aliases: true,
  distributionGroups: true,
  dkimSigning: true,
  tlsEnforcement: true,
  adminApi: true,
}

const STALWART_LIMITS: EngineLimits = {
  maxMessageSizeBytes: 52_428_800,
  maxRecipientsPerMessage: 100,
  maxAttachmentSizeBytes: 36_700_160,
}

export interface StalwartEngineAdapterOptions {
  endpoint: string
  token?: string
  username?: string
  password?: string
  allowInsecureHttp?: boolean
  timeoutMs?: number
  fetchImpl?: FetchLike
  profile?: StalwartProtocolProfile
  accountId?: string
  engineVersion?: string
  retry?: Partial<RetryPolicy>
}

interface ResolvedResource {
  id?: string
  managed?: Record<string, unknown>
}

interface AppliedMutation {
  step: EnginePlanStep
  action: 'created' | 'updated'
  resourceId: string
  previous?: Record<string, unknown>
}

function resolveAuth(options: StalwartEngineAdapterOptions): AuthProvider {
  if (options.token !== undefined && options.token.length > 0) {
    return new BearerTokenAuth(options.token)
  }
  if (options.username !== undefined && options.password !== undefined) {
    return new BasicAuth(options.username, options.password)
  }
  throw new EngineError({
    category: 'validation',
    message: 'Stalwart adapter requires a bearer token or username/password credentials',
  })
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function toStepError(error: EngineError): EngineStepError {
  return { code: error.navinCode, message: error.message }
}

function isInterruption(error: EngineError): boolean {
  return error.category === 'cancelled' || error.category === 'timeout'
}

function preconditionFailure(step: EnginePlanStep, detail: string): EngineError {
  return new EngineError({
    category: 'precondition',
    message: `Precondition failed for ${step.kind} ${step.target}: ${detail}`,
    details: { stepId: step.id },
  })
}

function snapshotMatches(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): boolean {
  return stableStringify(expected) === stableStringify(actual)
}

export class StalwartEngineAdapter implements MailEngineAdapter {
  readonly descriptor: EngineDescriptor
  private readonly transport: HttpTransport
  private readonly client: StalwartAdminClient
  private readonly profile: StalwartProtocolProfile

  constructor(options: StalwartEngineAdapterOptions) {
    this.profile = options.profile ?? DEFAULT_STALWART_PROFILE
    this.transport = new HttpTransport({
      baseUrl: options.endpoint,
      auth: resolveAuth(options),
      defaultTimeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      allowInsecureHttp: options.allowInsecureHttp,
      retry: options.retry,
      userAgent: '@navin/engine-core/stalwart',
    })
    this.client = new StalwartAdminClient({
      transport: this.transport,
      profile: this.profile,
      accountId: options.accountId,
    })
    this.descriptor = {
      engineId: 'stalwart',
      displayName: 'Stalwart Mail Server (admin adapter)',
      version: options.engineVersion ?? 'unknown',
      protocols: STALWART_PROTOCOLS,
      features: STALWART_FEATURES,
      limits: STALWART_LIMITS,
      connection: {
        endpoint: this.transport.baseUrl.origin,
        secure: this.transport.secure,
        authMethods: [this.transport.auth.scheme],
      },
    }
  }

  async health(options: EngineCallOptions = {}): Promise<EngineHealthReport> {
    const observedAt = new Date().toISOString()
    const checks: EngineHealthCheck[] = []
    const started = Date.now()
    let ok = false
    let status = 'unavailable'

    try {
      const response = await this.transport.request<{ status?: unknown } | undefined>(
        { method: 'GET', path: this.profile.healthPath },
        this.callOptions(options),
      )
      ok = true
      status = asString(response.data?.status) ?? 'ready'
      checks.push({ name: 'readiness', passed: true })
    } catch (error) {
      const engineError = normalizeEngineError(error, { requestId: options.requestId })
      if (isInterruption(engineError)) throw engineError
      checks.push({ name: 'readiness', passed: false, detail: engineError.message })
      try {
        await this.transport.request(
          { method: 'GET', path: this.profile.livenessPath },
          this.callOptions(options),
        )
        checks.push({ name: 'liveness', passed: true })
        status = 'degraded'
      } catch (livenessError) {
        const liveEngineError = normalizeEngineError(livenessError, {
          requestId: options.requestId,
        })
        if (isInterruption(liveEngineError)) throw liveEngineError
        checks.push({ name: 'liveness', passed: false, detail: liveEngineError.message })
      }
    }

    return { ok, status, observedAt, latencyMs: Date.now() - started, checks }
  }

  async version(options: EngineCallOptions = {}): Promise<EngineVersionReport> {
    const response = await this.transport.request<StalwartVersionInfo | undefined>(
      { method: 'GET', path: this.profile.versionPath },
      this.callOptions(options),
    )
    const data = response.data ?? {}
    const report: EngineVersionReport = {
      engineId: this.descriptor.engineId,
      version: asString(data.version) ?? this.descriptor.version,
      observedAt: new Date().toISOString(),
    }
    const product = asString(data.product)
    if (product !== undefined) report.product = product
    const build = asString(data.build)
    if (build !== undefined) report.build = build
    return report
  }

  async discover(options: EngineCallOptions = {}): Promise<EngineDiscoveryReport> {
    const warnings: string[] = []
    const healthReport = await this.health(options)
    if (!healthReport.ok) warnings.push(`Engine health is ${healthReport.status}`)

    try {
      await this.version(options)
    } catch (error) {
      const engineError = normalizeEngineError(error, { requestId: options.requestId })
      if (isInterruption(engineError)) throw engineError
      warnings.push(`Version discovery failed: ${engineError.message}`)
    }

    const rawDomains = await this.safeFind(
      () => this.client.findDomains({}, this.callOptions(options)),
      'domains',
      warnings,
      options,
    )
    const rawAccounts = await this.safeFind(
      () => this.client.findAccounts({}, this.callOptions(options)),
      'mailboxes',
      warnings,
      options,
    )
    const rawAliases = await this.safeFind(
      () => this.client.findAliases({}, this.callOptions(options)),
      'aliases',
      warnings,
      options,
    )

    const domains = rawDomains.map(toDomainRecord)
    const domainNameById = new Map(domains.map((domain) => [domain.id, domain.name]))

    const mailboxes = rawAccounts.map((account) => {
      const domainName = domainNameById.get(account.domainId)
      if (domainName === undefined) {
        warnings.push(`Mailbox ${account.id} references unknown domain ${account.domainId}`)
      }
      return toMailboxRecord(account, domainName ?? 'unknown.invalid')
    })

    const aliases = rawAliases.map((alias) => {
      const domainName = domainNameById.get(alias.domainId)
      if (domainName === undefined) {
        warnings.push(`Alias ${alias.id} references unknown domain ${alias.domainId}`)
      }
      return toAliasRecord(alias, domainName ?? 'unknown.invalid')
    })

    return {
      engine: this.descriptor,
      endpoint: this.transport.baseUrl.origin,
      secure: this.transport.secure,
      observedAt: new Date().toISOString(),
      domains,
      mailboxes,
      aliases,
      counts: { domains: domains.length, mailboxes: mailboxes.length, aliases: aliases.length },
      warnings,
    }
  }

  async planDomain(spec: DomainSpec, options: EngineCallOptions = {}): Promise<EnginePlan> {
    const name = normalizeDomainName(spec.name)
    const desired = domainSpecToDesired(spec)
    const matches = await this.client.findDomains({ name }, this.callOptions(options))
    const observed = matches[0]
    return buildPlan({
      kind: 'domain',
      target: name,
      desired,
      observed: observed ? stalwartDomainToManaged(observed) : undefined,
      observedId: observed?.id,
    })
  }

  async planMailbox(spec: MailboxSpec, options: EngineCallOptions = {}): Promise<EnginePlan> {
    const parsed = parseEmailAddress(spec.email)
    const domainId = await this.resolveDomainId(parsed.domain, options)
    const desired = mailboxSpecToDesired(spec, domainId)
    const matches = await this.client.findAccounts(
      { name: parsed.localPart, domainId },
      this.callOptions(options),
    )
    const observed = matches[0]
    return buildPlan({
      kind: 'mailbox',
      target: parsed.address,
      desired,
      observed: observed ? stalwartAccountToManaged(observed) : undefined,
      observedId: observed?.id,
    })
  }

  async planAlias(spec: AliasSpec, options: EngineCallOptions = {}): Promise<EnginePlan> {
    const parsed = parseEmailAddress(spec.address)
    const domainId = await this.resolveDomainId(parsed.domain, options)
    const desired = aliasSpecToDesired(spec, domainId)
    const matches = await this.client.findAliases(
      { name: parsed.localPart, domainId },
      this.callOptions(options),
    )
    const observed = matches[0]
    return buildPlan({
      kind: 'alias',
      target: parsed.address,
      desired,
      observed: observed ? stalwartAliasToManaged(observed) : undefined,
      observedId: observed?.id,
    })
  }

  async apply(plan: EnginePlan, options: EngineApplyOptions = {}): Promise<EngineApplyResult> {
    const appliedAt = new Date().toISOString()
    const steps: EngineApplyStepResult[] = []
    const appliedResourceIds: Record<string, string> = {}
    const mutations: AppliedMutation[] = []
    let ok = true
    let rolledBack = false

    for (const step of plan.steps) {
      try {
        const current = await this.resolveCurrent(step, options)
        if (current.id !== undefined) appliedResourceIds[step.id] = current.id

        if (step.op === 'noop') {
          if (
            current.managed === undefined ||
            !changesAreSatisfied(step.desired, current.managed)
          ) {
            throw preconditionFailure(step, 'the live resource no longer satisfies the no-op plan')
          }
          steps.push({
            stepId: step.id,
            kind: step.kind,
            op: step.op,
            status: 'skipped',
            resourceId: current.id,
          })
          continue
        }

        if (current.managed !== undefined && changesAreSatisfied(step.desired, current.managed)) {
          steps.push({
            stepId: step.id,
            kind: step.kind,
            op: step.op,
            status: 'skipped',
            resourceId: current.id,
          })
          continue
        }
        if (step.op === 'create' && current.id !== undefined) {
          throw preconditionFailure(step, 'a different live resource already exists')
        }
        if (step.op === 'update') {
          if (current.id === undefined || current.managed === undefined) {
            throw preconditionFailure(step, 'the planned resource is missing')
          }
          if (step.observed === undefined || !snapshotMatches(step.observed, current.managed)) {
            throw preconditionFailure(step, 'the resource changed after planning')
          }
        }

        const idempotencyKey = `${options.idempotencyKey ?? plan.idempotencyKey}:${step.id}`
        const secretFields = options.secrets?.[step.id] ?? {}
        const payload = { ...step.desired, ...secretFields }
        if (current.id === undefined) {
          const createdId = await this.client.createObject(
            step.kind,
            payload,
            this.callOptions(options, idempotencyKey),
          )
          appliedResourceIds[step.id] = createdId
          steps.push({
            stepId: step.id,
            kind: step.kind,
            op: 'create',
            status: 'applied',
            resourceId: createdId,
          })
          mutations.push({ step, action: 'created', resourceId: createdId })
        } else {
          await this.client.updateObject(
            step.kind,
            current.id,
            payload,
            this.callOptions(options, idempotencyKey),
          )
          appliedResourceIds[step.id] = current.id
          steps.push({
            stepId: step.id,
            kind: step.kind,
            op: 'update',
            status: 'applied',
            resourceId: current.id,
          })
          mutations.push({
            step,
            action: 'updated',
            resourceId: current.id,
            previous: current.managed,
          })
        }
      } catch (error) {
        const engineError = normalizeEngineError(error, { requestId: options.requestId })
        if (isInterruption(engineError)) throw engineError
        ok = false
        steps.push({
          stepId: step.id,
          kind: step.kind,
          op: step.op,
          status: 'failed',
          error: toStepError(engineError),
        })
        if (options.rollbackOnFailure === true && mutations.length > 0) {
          rolledBack = await this.rollbackMutations(mutations, options)
        }
        break
      }
    }

    return { planId: plan.planId, appliedAt, ok, rolledBack, steps, appliedResourceIds }
  }

  async verify(plan: EnginePlan, options: EngineCallOptions = {}): Promise<EngineVerifyResult> {
    const checks: EngineVerifyCheck[] = []
    let passed = true

    for (const step of plan.steps) {
      const current = await this.resolveCurrent(step, options)
      const satisfied =
        current.managed !== undefined && changesAreSatisfied(step.desired, current.managed)
      if (!satisfied) passed = false
      const check: EngineVerifyCheck = {
        stepId: step.id,
        command: `verify ${step.kind} ${step.target}`,
        expected: step.desired,
        passed: satisfied,
      }
      if (current.managed !== undefined) check.actual = current.managed
      checks.push(check)
    }

    return { planId: plan.planId, verifiedAt: new Date().toISOString(), passed, checks }
  }

  async rollback(plan: EnginePlan, options: EngineCallOptions = {}): Promise<EngineRollbackResult> {
    const steps: EngineRollbackStepResult[] = []
    let passed = true

    for (const step of [...plan.steps].reverse()) {
      if (step.op === 'noop') {
        steps.push({ stepId: step.id, action: 'skipped' })
        continue
      }
      try {
        const current = await this.resolveCurrent(step, options)
        const key = `${plan.idempotencyKey}:rollback:${step.id}`
        if (step.op === 'create' || step.observed === undefined) {
          if (current.id === undefined) {
            steps.push({ stepId: step.id, action: 'skipped' })
            continue
          }
          if (
            current.managed === undefined ||
            !changesAreSatisfied(step.desired, current.managed)
          ) {
            throw preconditionFailure(step, 'refusing to destroy a resource changed after apply')
          }
          const destroyed = await this.client.destroyObject(
            step.kind,
            current.id,
            this.callOptions(options, key),
          )
          steps.push({
            stepId: step.id,
            action: destroyed ? 'destroyed' : 'skipped',
            resourceId: current.id,
          })
        } else {
          if (current.id === undefined || current.managed === undefined) {
            throw preconditionFailure(step, 'the applied resource is missing')
          }
          if (!changesAreSatisfied(step.desired, current.managed)) {
            throw preconditionFailure(step, 'refusing to restore a resource changed after apply')
          }
          await this.client.updateObject(
            step.kind,
            current.id,
            step.observed,
            this.callOptions(options, key),
          )
          steps.push({ stepId: step.id, action: 'reverted', resourceId: current.id })
        }
      } catch (error) {
        const engineError = normalizeEngineError(error, { requestId: options.requestId })
        if (isInterruption(engineError)) throw engineError
        passed = false
        steps.push({ stepId: step.id, action: 'failed', error: toStepError(engineError) })
      }
    }

    return { planId: plan.planId, rolledBackAt: new Date().toISOString(), passed, steps }
  }

  private async resolveDomainId(domain: string, options: EngineCallOptions): Promise<string> {
    const matches = await this.client.findDomains({ name: domain }, this.callOptions(options))
    const found = matches[0]
    if (!found) {
      throw new EngineError({
        category: 'not_found',
        message: `Domain ${domain} was not found on the engine`,
        details: { domain },
      })
    }
    return found.id
  }

  private async resolveCurrent(
    step: EnginePlanStep,
    options: EngineCallOptions,
  ): Promise<ResolvedResource> {
    if (step.kind === 'domain') {
      const matches = await this.client.findDomains(
        { name: step.target },
        this.callOptions(options),
      )
      const match = matches[0]
      return match ? { id: match.id, managed: stalwartDomainToManaged(match) } : {}
    }

    const name = asString(step.desired.name)
    const domainId = asString(step.desired.domainId)
    if (name === undefined || domainId === undefined) return {}

    if (step.kind === 'mailbox') {
      const matches = await this.client.findAccounts({ name, domainId }, this.callOptions(options))
      const match = matches[0]
      return match ? { id: match.id, managed: stalwartAccountToManaged(match) } : {}
    }

    const matches = await this.client.findAliases({ name, domainId }, this.callOptions(options))
    const match = matches[0]
    return match ? { id: match.id, managed: stalwartAliasToManaged(match) } : {}
  }

  private async rollbackMutations(
    mutations: AppliedMutation[],
    options: EngineCallOptions,
  ): Promise<boolean> {
    let allOk = true
    for (const mutation of [...mutations].reverse()) {
      try {
        const current = await this.resolveCurrent(mutation.step, options)
        if (current.id !== mutation.resourceId || current.managed === undefined) {
          allOk = false
          continue
        }
        if (!changesAreSatisfied(mutation.step.desired, current.managed)) {
          allOk = false
          continue
        }
        if (mutation.action === 'created') {
          const destroyed = await this.client.destroyObject(
            mutation.step.kind,
            mutation.resourceId,
            this.callOptions(options),
          )
          if (!destroyed) allOk = false
        } else if (mutation.previous !== undefined) {
          await this.client.updateObject(
            mutation.step.kind,
            mutation.resourceId,
            mutation.previous,
            this.callOptions(options),
          )
        }
      } catch {
        allOk = false
      }
    }
    return allOk
  }

  private async safeFind<T>(
    loader: () => Promise<T[]>,
    label: string,
    warnings: string[],
    options: EngineCallOptions,
  ): Promise<T[]> {
    try {
      return await loader()
    } catch (error) {
      const engineError = normalizeEngineError(error, { requestId: options.requestId })
      if (isInterruption(engineError)) throw engineError
      warnings.push(`Discovery of ${label} failed: ${engineError.message}`)
      return []
    }
  }

  private callOptions(options: EngineCallOptions, idempotencyKey?: string): TransportCallOptions {
    const callOptions: TransportCallOptions = {}
    if (options.signal) callOptions.signal = options.signal
    if (options.timeoutMs !== undefined) callOptions.timeoutMs = options.timeoutMs
    if (options.requestId) callOptions.requestId = options.requestId
    if (idempotencyKey) callOptions.idempotencyKey = idempotencyKey
    return callOptions
  }
}
