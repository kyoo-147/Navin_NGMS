import { join } from 'node:path'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { REDACTED } from '../logging/redact.js'
import { ConfigSchema, type AppConfig, type MailConfig } from './schema.js'

const compiledConfig = TypeCompiler.Compile(ConfigSchema)

export const DEV_SESSION_SECRET = 'navin-development-session-secret-0000'
export const DEV_ENCRYPTION_KEY = 'navin-development-encryption-key-0000'

export interface ConfigIssue {
  path: string
  message: string
}

export class ConfigValidationError extends Error {
  readonly issues: ConfigIssue[]

  constructor(issues: ConfigIssue[]) {
    const detail = issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')
    super(`Invalid configuration: ${detail}`)
    this.name = 'ConfigValidationError'
    this.issues = issues
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv
  /** Applies after environment parsing and before validation. */
  overrides?: Partial<AppConfig>
}

function readInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  issues: ConfigIssue[],
): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    issues.push({ path: key, message: `must be an integer, received "${raw}"` })
    return fallback
  }
  return parsed
}

function readBoolean(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean,
  issues: ConfigIssue[],
): boolean {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const normalized = raw.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false
  }
  issues.push({ path: key, message: `must be a boolean, received "${raw}"` })
  return fallback
}

function readMailConfig(env: NodeJS.ProcessEnv): MailConfig {
  return {
    jmapSessionUrl: env.NAVIN_MAIL_JMAP_SESSION_URL?.trim() || null,
    jmapAuthorization: env.NAVIN_MAIL_JMAP_AUTHORIZATION?.trim() || null,
    accountEmail: env.NAVIN_MAIL_ACCOUNT_EMAIL?.trim() || null,
    senderIdentityId: env.NAVIN_MAIL_SENDER_IDENTITY_ID?.trim() || null,
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

/**
 * Parse, validate and deep-freeze the runtime configuration.
 *
 * Environment variables are the only external input. Unknown keys never enter
 * the result, and the returned object is the single source of truth consumed
 * by the kernel. Secret fallbacks and production rules are evaluated against
 * the final environment *after* overrides, so an override can never leave
 * development placeholders in a production configuration.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env
  const issues: ConfigIssue[] = []

  const environment = (env.NAVIN_ENVIRONMENT ?? 'development').trim()
  const dataDir = env.NAVIN_DATA_DIR?.trim() || './data'

  const candidate: AppConfig = {
    environment: environment as AppConfig['environment'],
    host: env.NAVIN_HOST?.trim() || '127.0.0.1',
    port: readInteger(env, 'NAVIN_PORT', 8080, issues),
    logLevel: (env.NAVIN_LOG_LEVEL?.trim() || 'info') as AppConfig['logLevel'],
    dataDir,
    databasePath: env.NAVIN_DATABASE_PATH?.trim() || join(dataDir, 'navin.db'),
    shutdownTimeoutMs: readInteger(env, 'NAVIN_SHUTDOWN_TIMEOUT_MS', 10000, issues),
    trustProxy: readBoolean(env, 'NAVIN_TRUST_PROXY', false, issues),
    bodyLimitBytes: readInteger(env, 'NAVIN_BODY_LIMIT_BYTES', 1048576, issues),
    secrets: {
      sessionSecret: env.NAVIN_SESSION_SECRET?.trim() || '',
      encryptionKey: env.NAVIN_ENCRYPTION_KEY?.trim() || '',
    },
    mail: readMailConfig(env),
    ...options.overrides,
  }

  const isProduction = candidate.environment === 'production'

  if (!isProduction) {
    candidate.secrets = {
      sessionSecret: candidate.secrets.sessionSecret || DEV_SESSION_SECRET,
      encryptionKey: candidate.secrets.encryptionKey || DEV_ENCRYPTION_KEY,
    }
  }

  if (!compiledConfig.Check(candidate)) {
    for (const error of compiledConfig.Errors(candidate)) {
      issues.push({ path: error.path || '/', message: error.message })
    }
  }

  if (isProduction) {
    if (!candidate.secrets.sessionSecret || candidate.secrets.sessionSecret === DEV_SESSION_SECRET) {
      issues.push({ path: 'NAVIN_SESSION_SECRET', message: 'must be set in production' })
    }
    if (!candidate.secrets.encryptionKey || candidate.secrets.encryptionKey === DEV_ENCRYPTION_KEY) {
      issues.push({ path: 'NAVIN_ENCRYPTION_KEY', message: 'must be set in production' })
    }
  }

  // Fail closed on a half-configured upstream mail binding: either every mail
  // value is provided, or mail is intentionally unset and every Mail endpoint
  // rejects requests.
  const mailValues = [
    candidate.mail.jmapSessionUrl,
    candidate.mail.jmapAuthorization,
    candidate.mail.accountEmail,
  ]
  const mailSetCount = mailValues.filter((value) => value !== null).length
  if (mailSetCount > 0 && mailSetCount < mailValues.length) {
    issues.push({
      path: 'NAVIN_MAIL_*',
      message:
        'upstream mail binding must be fully configured (session URL, authorization, account email) or entirely unset',
    })
  }
  if (candidate.mail.senderIdentityId !== null && mailSetCount < mailValues.length) {
    issues.push({
      path: 'NAVIN_MAIL_SENDER_IDENTITY_ID',
      message: 'sender identity requires a complete upstream mail binding',
    })
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues)
  }

  return deepFreeze(candidate)
}

/** Returns a frozen copy of the configuration with secret material masked. */
export function redactConfig(config: AppConfig): AppConfig {
  return deepFreeze({
    ...config,
    secrets: {
      sessionSecret: REDACTED,
      encryptionKey: REDACTED,
    },
    mail: {
      ...config.mail,
      jmapAuthorization: config.mail.jmapAuthorization === null ? null : REDACTED,
    },
  })
}
