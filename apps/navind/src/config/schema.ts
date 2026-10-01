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
  },
  { additionalProperties: false },
)

export type AppConfig = Static<typeof ConfigSchema>
export type AppEnvironment = Static<typeof EnvironmentSchema>
export type SecretConfig = Static<typeof SecretsSchema>
