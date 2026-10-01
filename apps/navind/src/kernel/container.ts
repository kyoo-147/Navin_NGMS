import { JsonLogger } from '../adapters/json-logger.js'
import { RandomIdGenerator } from '../adapters/random-id-generator.js'
import { SqliteDatabaseFactory } from '../adapters/sqlite-database.js'
import { SystemClock } from '../adapters/system-clock.js'
import type { AppConfig } from '../config/schema.js'
import type { Clock } from '../ports/clock.js'
import type { DatabaseFactory } from '../ports/database.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { Logger, LoggerSink } from '../ports/logger.js'
import { SERVICE_NAME, SERVICE_VERSION } from '../version.js'

/**
 * Dependency container.
 *
 * Holds the always-available adapters. Stateful resources that only exist
 * while the kernel is running (the database connection, the HTTP server) are
 * created and torn down by the kernel itself so their lifecycle is explicit.
 */
export interface Container {
  readonly config: AppConfig
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly logger: Logger
  readonly databaseFactory: DatabaseFactory
}

export interface CreateContainerOptions {
  /** Overrides the log sink; primarily used by tests to capture records. */
  sink?: LoggerSink
}

export function createContainer(
  config: AppConfig,
  options: CreateContainerOptions = {},
): Container {
  const clock = new SystemClock()
  const ids = new RandomIdGenerator()
  const logger = new JsonLogger({
    level: config.logLevel,
    clock,
    sink: options.sink,
    // Register configuration secrets so they are scrubbed even if they surface
    // inside a free-text message or stack trace.
    redactLiterals: [
      config.secrets.sessionSecret,
      config.secrets.encryptionKey,
      ...(config.mail.jmapAuthorization ? [config.mail.jmapAuthorization] : []),
      ...(config.engine.token ? [config.engine.token] : []),
      ...(config.engine.password ? [config.engine.password] : []),
    ],
    base: {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      env: config.environment,
    },
  })
  const databaseFactory = new SqliteDatabaseFactory()

  return { config, clock, ids, logger, databaseFactory }
}
