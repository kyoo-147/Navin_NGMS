import { Type, type Static } from '@sinclair/typebox'
import { LOG_LEVELS } from '../ports/logger.js'

export const EnvironmentSchema = Type.Union([
  Type.Literal('development'),
  Type.Literal('test'),
  Type.Literal('production'),
])

export const LogLevelSchema = Type.Union(LOG_LEVELS.map((level) => Type.Literal(level)))

export const SecretsSchema = Type.Object(
  {
    sessionSecret: Type.String({ minLength: 16 }),
    encryptionKey: Type.String({ minLength: 16 }),
  },
  { additionalProperties: false },
)

/**
 * Server-side upstream mail (JMAP) binding for the Mail BFF.
 *
 * `jmapSessionUrl`, `jmapAuthorization` and `accountEmail` are either all
 * provided (mail is enabled) or all `null` (mail is disabled and every Mail
 * endpoint fails closed). `senderIdentityId` is an optional, validated sender
 * identity that enables the compose/send path; without it Mail stays read-only.
 * The upstream authorization value is a secret and is redacted from logs and
 * redacted configuration.
 */
export const MailConfigSchema = Type.Object(
  {
    jmapSessionUrl: Type.Union([
      Type.String({ minLength: 1, description: 'Upstream JMAP session URL (server-side only)' }),
      Type.Null(),
    ]),
    jmapAuthorization: Type.Union([
      Type.String({ minLength: 1, description: 'Upstream Authorization header value' }),
      Type.Null(),
    ]),
    accountEmail: Type.Union([
      Type.String({
        minLength: 3,
        maxLength: 320,
        pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
        description: 'Mailbox address the session must match to resolve credentials',
      }),
      Type.Null(),
    ]),
    senderIdentityId: Type.Union([
      Type.String({
        minLength: 3,
        maxLength: 128,
        pattern: '^(?:usr|als)_[a-zA-Z0-9._-]+$',
        description: 'Authorized sender identity used for submissions (prefixed usr_/als_)',
      }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
)

export const ConfigSchema = Type.Object(
  {
    environment: EnvironmentSchema,
    host: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 0, maximum: 65535 }),
    logLevel: LogLevelSchema,
    dataDir: Type.String({ minLength: 1 }),
    databasePath: Type.String({ minLength: 1 }),
    shutdownTimeoutMs: Type.Integer({ minimum: 100, maximum: 120000 }),
    trustProxy: Type.Boolean(),
    bodyLimitBytes: Type.Integer({ minimum: 1024, maximum: 104857600 }),
    secrets: SecretsSchema,
    mail: MailConfigSchema,
  },
  { additionalProperties: false },
)

export type AppConfig = Static<typeof ConfigSchema>
export type AppEnvironment = Static<typeof EnvironmentSchema>
export type SecretConfig = Static<typeof SecretsSchema>
export type MailConfig = Static<typeof MailConfigSchema>

/** True only when the upstream mail binding is complete. */
export function isMailConfigured(mail: MailConfig): boolean {
  return (
    mail.jmapSessionUrl !== null && mail.jmapAuthorization !== null && mail.accountEmail !== null
  )
}
