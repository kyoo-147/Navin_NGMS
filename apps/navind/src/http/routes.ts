import type { FastifyInstance } from 'fastify'
import type { Clock } from '../ports/clock.js'
import type { HealthRegistry } from '../ports/health.js'
import { API_VERSION, SERVICE_NAME, SERVICE_VERSION } from '../version.js'
import type { AppConfig } from '../config/schema.js'
import type { SetupService } from '@navin/setup-core'
import type { OrganizationService } from '@navin/organization-core'
import { ControlAuthorization } from '../setup/auth.js'
import { registerSetupRoutes } from '../setup/routes.js'
import { registerOrganizationRoutes } from '../organization/routes.js'
import type { MailAuthorization } from '../mail/auth.js'
import type { MailService } from '../mail/service.js'
import { registerMailRoutes } from '../mail/routes.js'

export interface RouteDependencies {
  config: AppConfig
  clock: Clock
  health: HealthRegistry
  startedAt: number
  setup?: SetupService
  auth?: ControlAuthorization
  organization?: OrganizationService
  mail?: MailService
  mailAuth?: MailAuthorization
}

export function registerRoutes(app: FastifyInstance, deps: RouteDependencies): void {
  app.get('/health', (request) => {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      apiVersion: API_VERSION,
      environment: deps.config.environment,
      uptimeMs: Date.now() - deps.startedAt,
      timestamp: deps.clock.nowIso(),
      correlationId: request.correlationId,
    }
  })

  app.get('/ready', async (request, reply) => {
    const report = await deps.health.run()
    const ready = report.state === 'healthy'
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      checks: report.checks,
      timestamp: report.timestamp,
      correlationId: request.correlationId,
    })
  })

  app.get('/meta', (request) => {
    return {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      apiVersion: API_VERSION,
      environment: deps.config.environment,
      node: process.version,
      platform: process.platform,
      pid: process.pid,
      startedAt: new Date(deps.startedAt).toISOString(),
      correlationId: request.correlationId,
    }
  })

  if (deps.setup && deps.auth) {
    registerSetupRoutes(app, { setup: deps.setup, auth: deps.auth, clock: deps.clock })
  }

  if (deps.organization && deps.auth) {
    registerOrganizationRoutes(app, {
      organization: deps.organization,
      auth: deps.auth,
      clock: deps.clock,
    })
  }

  if (deps.mail && deps.mailAuth) {
    registerMailRoutes(app, { mail: deps.mail, auth: deps.mailAuth, clock: deps.clock })
  }
}
