import type { FastifyInstance, FastifyReply } from 'fastify'
import { isActionCoreError } from '@navin/action-core'
import { CONTROL_SCOPES, isAuthError } from '@navin/auth'
import type { AuditActor, NavinErrorCode } from '@navin/contracts'
import { isOrganizationError, type OrganizationService } from '@navin/organization-core'
import { errorEnvelope, type HttpErrorCode } from '../http/errors.js'
import type { Clock } from '../ports/clock.js'
import { ControlAuthorization } from '../setup/auth.js'

interface OrganizationRouteDependencies {
  organization: OrganizationService
  auth: ControlAuthorization
  clock: Clock
}

type Body = Record<string, unknown>
type Params = { actionId?: string }

const BASE = '/api/v1/control/organization'

export function registerOrganizationRoutes(
  app: FastifyInstance,
  deps: OrganizationRouteDependencies,
): void {
  app.post(`${BASE}/aliases/plan`, (request, reply) => {
    try {
      const session = deps.auth.authenticate(request, CONTROL_SCOPES.plan)
      const body = (request.body ?? {}) as Body
      return deps.organization
        .planAlias(readAliasInput(body), {
          requestedBy: session.userId,
          ...(typeof body.idempotencyKey === 'string'
            ? { idempotencyKey: body.idempotencyKey }
            : {}),
          actor: actorFor(session.userId, session.roles, session.surface),
        })
        .then((view) => reply.send(view))
        .catch((error: unknown) => handleError(reply, deps.clock, error))
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.post(`${BASE}/aliases`, (request, reply) => {
    try {
      // A confirmed apply both applies and approves a Tier 1 mutation, so it
      // requires both authorities. A caller holding only `control:apply` (for
      // example `ops.operator`) is rejected before any engine work.
      const session = deps.auth.authenticateAll(request, [
        CONTROL_SCOPES.apply,
        CONTROL_SCOPES.approve,
      ])
      const body = (request.body ?? {}) as Body
      return deps.organization
        .provisionAlias(readAliasInput(body), {
          requestedBy: session.userId,
          confirm: body.confirm === true,
          ...(typeof body.idempotencyKey === 'string'
            ? { idempotencyKey: body.idempotencyKey }
            : {}),
          actor: actorFor(session.userId, session.roles, session.surface),
        })
        .then((view) => reply.send(view))
        .catch((error: unknown) => handleError(reply, deps.clock, error))
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.get<{ Params: Params }>(`${BASE}/actions/:actionId`, (request, reply) => {
    try {
      deps.auth.authenticate(request, CONTROL_SCOPES.discover)
      return reply.send(deps.organization.getAliasAction(request.params.actionId ?? ''))
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.post<{ Params: Params }>(`${BASE}/actions/:actionId/rollback`, (request, reply) => {
    try {
      const session = deps.auth.authenticate(request, CONTROL_SCOPES.rollback)
      return deps.organization
        .rollbackAlias(request.params.actionId ?? '', {
          actor: actorFor(session.userId, session.roles, session.surface),
        })
        .then((view) => reply.send(view))
        .catch((error: unknown) => handleError(reply, deps.clock, error))
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })
}

function readAliasInput(body: Body): { address: string; target: string; description?: string } {
  return {
    address: typeof body.address === 'string' ? body.address : '',
    target: typeof body.target === 'string' ? body.target : '',
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
  }
}

function actorFor(userId: string, roles: readonly string[], surface: string): AuditActor {
  const role = roles[0] ?? 'ops.operator'
  return {
    userId,
    role: role as AuditActor['role'],
    surface: surface as AuditActor['surface'],
  }
}

function errorCodeOf(error: unknown): NavinErrorCode | undefined {
  if (isOrganizationError(error) || isActionCoreError(error)) {
    return (error as { code: NavinErrorCode }).code
  }
  return undefined
}

const STATUS_BY_CODE: Partial<Record<NavinErrorCode, number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  APPROVAL_REQUIRED: 403,
  RISK_STEP_UP_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PRECONDITION_FAILED: 409,
  ACTION_BLOCKED: 409,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
}

function handleError(reply: FastifyReply, clock: Clock, error: unknown) {
  if (isAuthError(error)) {
    const status = error.code === 'INSUFFICIENT_SCOPE' || error.code === 'FORBIDDEN' ? 403 : 401
    return sendError(
      reply,
      clock,
      status,
      status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED',
      error.message,
    )
  }

  const code = errorCodeOf(error)
  if (code !== undefined) {
    const status = STATUS_BY_CODE[code] ?? 500
    const details =
      isOrganizationError(error) || isActionCoreError(error)
        ? (error as { details?: Record<string, unknown> }).details
        : undefined
    return sendError(reply, clock, status, code, errorMessage(error), details)
  }

  return sendError(reply, clock, 500, 'INTERNAL_ERROR', 'Internal server error')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  return 'Organization action failed'
}

function sendError(
  reply: FastifyReply,
  clock: Clock,
  status: number,
  code: HttpErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  return reply.code(status).send(
    errorEnvelope({
      code,
      message,
      retryable: status >= 500,
      correlationId: reply.request.correlationId,
      timestamp: clock.nowIso(),
      ...(details === undefined ? {} : { details }),
    }),
  )
}
