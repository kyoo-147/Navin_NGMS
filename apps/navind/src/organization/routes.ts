import type { FastifyInstance, FastifyReply } from 'fastify'
import { isActionCoreError } from '@navin/action-core'
import { CONTROL_SCOPES, isAuthError } from '@navin/auth'
import type { AuditActor, NavinErrorCode } from '@navin/contracts'
import {
  isOrganizationError,
  OrganizationError,
  type OrganizationService,
} from '@navin/organization-core'
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

  app.post(`${BASE}/domains/plan`, (request, reply) => {
    try {
      const session = deps.auth.authenticate(request, CONTROL_SCOPES.plan)
      const body = (request.body ?? {}) as Body
      return deps.organization
        .planDomain(readDomainInput(body), {
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

  app.post(`${BASE}/domains`, (request, reply) => {
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
        .provisionDomain(readDomainInput(body), {
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

  app.get<{ Params: Params }>(`${BASE}/domains/actions/:actionId`, (request, reply) => {
    try {
      deps.auth.authenticate(request, CONTROL_SCOPES.discover)
      return reply.send(deps.organization.getDomainAction(request.params.actionId ?? ''))
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.post<{ Params: Params }>(`${BASE}/domains/actions/:actionId/rollback`, (request, reply) => {
    try {
      const session = deps.auth.authenticate(request, CONTROL_SCOPES.rollback)
      return deps.organization
        .rollbackDomain(request.params.actionId ?? '', {
          actor: actorFor(session.userId, session.roles, session.surface),
        })
        .then((view) => reply.send(view))
        .catch((error: unknown) => handleError(reply, deps.clock, error))
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.post(`${BASE}/mailboxes/plan`, (request, reply) => {
    try {
      const session = deps.auth.authenticate(request, CONTROL_SCOPES.plan)
      const body = (request.body ?? {}) as Body
      return deps.organization
        .planMailbox(readMailboxInput(body), {
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

  app.post(`${BASE}/mailboxes`, (request, reply) => {
    try {
      // A mailbox create both applies and approves a Tier 1 mutation, so it
      // requires both authorities; a caller holding only `control:apply` is
      // rejected before any engine work.
      const session = deps.auth.authenticateAll(request, [
        CONTROL_SCOPES.apply,
        CONTROL_SCOPES.approve,
      ])
      const body = (request.body ?? {}) as Body
      return deps.organization
        .provisionMailbox(readMailboxInput(body, true), {
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

  app.get<{ Params: Params }>(`${BASE}/mailboxes/actions/:actionId`, (request, reply) => {
    try {
      deps.auth.authenticate(request, CONTROL_SCOPES.discover)
      return reply.send(deps.organization.getMailboxAction(request.params.actionId ?? ''))
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.post<{ Params: Params }>(`${BASE}/mailboxes/actions/:actionId/rollback`, (request, reply) => {
    try {
      // Destructive: both authorities, then Tier-3 recent step-up plus the
      // exact canonical mailbox address as typed confirmation. `--yes` is not
      // part of this route and can never bypass the gate.
      const session = deps.auth.authenticateAll(request, [
        CONTROL_SCOPES.apply,
        CONTROL_SCOPES.approve,
      ])
      const actionId = request.params.actionId ?? ''
      const body = (request.body ?? {}) as Body
      const confirmation = typeof body.confirmation === 'string' ? body.confirmation : undefined
      const expectedConfirmation = deps.organization.mailboxRollbackTarget(actionId)
      deps.auth.service.assertTier3({ session, confirmation, expectedConfirmation })
      return deps.organization
        .rollbackMailbox(actionId, {
          ...(confirmation === undefined ? {} : { typedConfirmation: confirmation }),
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

function readDomainInput(body: Body): {
  name: string
  description?: string
  dkimSigning?: boolean
} {
  return {
    name: typeof body.name === 'string' ? body.name : '',
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
    ...(typeof body.dkimSigning === 'boolean' ? { dkimSigning: body.dkimSigning } : {}),
  }
}

/**
 * Reads a mailbox request. The password is only read for an apply (create) and
 * is never placed in the idempotency key, the action parameters or the job; a
 * non-string value is rejected rather than coerced. Planning is credential-free,
 * so a password on the plan route is rejected instead of being silently dropped.
 */
function readMailboxInput(
  body: Body,
  includePassword = false,
): { email: string; description?: string; password?: string } {
  if (!includePassword && body.password !== undefined) {
    throw new OrganizationError(
      'VALIDATION_FAILED',
      'Mailbox passwords are not accepted when planning; supply the password only when creating',
    )
  }
  if (includePassword && body.password !== undefined && typeof body.password !== 'string') {
    throw new OrganizationError('VALIDATION_FAILED', 'Mailbox password must be a string')
  }
  return {
    email: typeof body.email === 'string' ? body.email : '',
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
    ...(includePassword && typeof body.password === 'string' ? { password: body.password } : {}),
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
    // Tier-3 rollback gates: a missing/old step-up or a wrong typed
    // confirmation is a 403 with a typed code, never an authentication failure.
    if (error.code === 'STEP_UP_REQUIRED' || error.code === 'RECENT_AUTH_REQUIRED') {
      return sendError(reply, clock, 403, 'RISK_STEP_UP_REQUIRED', error.message)
    }
    if (error.code === 'TYPED_CONFIRMATION_REQUIRED') {
      return sendError(reply, clock, 403, 'APPROVAL_REQUIRED', error.message)
    }
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
