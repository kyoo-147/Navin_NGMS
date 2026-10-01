import Fastify, { type FastifyInstance } from 'fastify'
import type { AppConfig } from '../config/schema.js'
import type { Clock } from '../ports/clock.js'
import type { HealthRegistry } from '../ports/health.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { Logger } from '../ports/logger.js'
import './fastify-augment.js'
import {
  isValidCorrelationId,
  registerCorrelation,
  registerErrorHandling,
  registerRequestLogging,
} from './plugins.js'
import { registerRoutes } from './routes.js'
import type { SetupService } from '@navin/setup-core'
import type { ControlAuthorization } from '../setup/auth.js'

export interface ServerDependencies {
  config: AppConfig
  logger: Logger
  clock: Clock
  ids: IdGenerator
  health: HealthRegistry
  startedAt: number
  setup?: SetupService
  auth?: ControlAuthorization
}

export function buildServer(deps: ServerDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: deps.config.bodyLimitBytes,
    trustProxy: deps.config.trustProxy,
    genReqId: (request) => {
      const header = request.headers['x-correlation-id']
      const provided = Array.isArray(header) ? header[0] : header
      return isValidCorrelationId(provided) ? provided : deps.ids.next('req')
    },
  })

  registerCorrelation(app)
  registerRequestLogging(app, deps.logger)
  registerErrorHandling(app, deps.logger, deps.clock)
  registerRoutes(app, {
    config: deps.config,
    clock: deps.clock,
    health: deps.health,
    startedAt: deps.startedAt,
    setup: deps.setup,
    auth: deps.auth,
  })

  return app
}
