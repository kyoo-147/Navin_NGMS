import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { isAuthError } from '@navin/auth'
import type { SetupSession } from '@navin/contracts'
import { SetupCommandError, type SetupService } from '@navin/setup-core'
import { errorEnvelope } from '../http/errors.js'
import type { Clock } from '../ports/clock.js'
import { ControlAuthorization, controlScopeFor } from './auth.js'

interface SetupRouteDependencies {
  setup: SetupService
  auth: ControlAuthorization
  clock: Clock
}

type Params = { sessionId?: string }
type Body = Record<string, unknown>

export function registerSetupRoutes(app: FastifyInstance, deps: SetupRouteDependencies): void {
  registerAuthRoute(app, deps)
  for (const prefix of ['/api/v1/control/setup', '/api/v1/setup']) {
    registerSetupPrefix(app, deps, prefix)
  }
}

function registerAuthRoute(app: FastifyInstance, deps: SetupRouteDependencies): void {
  app.post('/api/v1/auth/login', (request, reply) => {
    try {
      const body = (request.body ?? {}) as Body
      const surface = request.headers['x-navin-surface']
      if (surface !== 'control' && surface !== 'cli') {
        return sendError(reply, deps.clock, 403, 'FORBIDDEN', 'Control surface required')
      }
      const issued = deps.auth.login({
        email: String(body.email ?? ''),
        password: String(body.password ?? ''),
        surface,
      })
      return reply.send({
        principal: issued.principal,
        token: issued.token,
        expiresAt: issued.expiresAt,
      })
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.get('/api/v1/auth/session', (request, reply) => {
    try {
      const session = deps.auth.authenticate(request, controlScopeFor('GET'))
      return reply.send({
        userId: session.userId,
        accountId: session.accountId,
        email: session.email,
        roles: session.roles,
        scopes: session.scopes,
        relyingParty: session.relyingParty,
        surface: session.surface,
        assuranceLevel: session.assuranceLevel,
      })
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.post('/api/v1/auth/step-up', (request, reply) => {
    try {
      const session = deps.auth.authenticate(request, controlScopeFor('POST', 'approve'))
      const body = (request.body ?? {}) as Body
      const password = String(body.password ?? '')
      const stepped = deps.auth.stepUp({ sessionId: session.sessionId, password })
      return reply.send({
        token: stepped.token,
        assuranceLevel: stepped.assuranceLevel,
        expiresAt: stepped.expiresAt,
      })
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })
}

function registerSetupPrefix(
  app: FastifyInstance,
  deps: SetupRouteDependencies,
  prefix: string,
): void {
  app.get(`${prefix}/sessions`, (request, reply) => {
    try {
      deps.auth.authenticate(request, controlScopeFor('GET'))
      return reply.send({ sessions: deps.setup.list() })
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.post(`${prefix}/sessions`, (request, reply) => {
    try {
      deps.auth.authenticate(request, controlScopeFor('POST', 'discover'))
      const body = (request.body ?? {}) as Body
      const session = deps.setup.create({
        title: String(body.title ?? ''),
        intelligenceMode: body.intelligenceMode as SetupSession['intelligenceMode'] | undefined,
        targetHost: body.targetHost as SetupSession['targetHost'] | undefined,
        initialStage: body.initialStage as SetupSession['currentStage'] | undefined,
        destructive: Boolean(body.destructive),
      })
      return reply.code(201).send(session)
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.get<{ Params: Params }>(`${prefix}/sessions/:sessionId`, (request, reply) => {
    try {
      deps.auth.authenticate(request, controlScopeFor('GET'))
      return reply.send(deps.setup.get(request.params.sessionId ?? ''))
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })

  app.post<{ Params: Params }>(`${prefix}/sessions/:sessionId/resume`, (request, reply) => {
    return runCommand(request, reply, deps, 'resume')
  })

  for (const command of ['discover', 'plan', 'diff', 'approve', 'apply', 'verify'] as const) {
    app.post<{ Params: Params }>(`${prefix}/sessions/:sessionId/${command}`, (request, reply) => {
      return runCommand(request, reply, deps, command)
    })
  }

  app.get<{ Params: Params }>(`${prefix}/sessions/:sessionId/events`, (request, reply) => {
    try {
      deps.auth.authenticate(request, controlScopeFor('GET'))
      const sessionId = request.params.sessionId ?? ''
      const queryCursor = (request.query as { cursor?: string } | undefined)?.cursor
      const cursor = parseCursor(request.headers['last-event-id'] ?? queryCursor)
      const raw = reply.raw
      reply.hijack()
      raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      raw.flushHeaders()
      let lastSeq = cursor
      const write = (stored: { seq: number; event: unknown }): void => {
        if (stored.seq > lastSeq) lastSeq = stored.seq
        raw.write(`id: ${stored.seq}\nevent: setup\ndata: ${JSON.stringify(stored.event)}\n\n`)
      }
      for (const event of deps.setup.eventsSince(sessionId, cursor)) {
        write(event)
      }
      const unsubscribe = deps.setup.subscribe(sessionId, (_event, stored) => {
        if (stored && stored.seq > lastSeq) {
          write(stored)
        } else {
          const missed = deps.setup.eventsSince(sessionId, lastSeq)
          for (const ev of missed) {
            write(ev)
          }
        }
      })
      const heartbeat = setInterval(() => raw.write(': keep-alive\n\n'), 15000)
      heartbeat.unref()
      request.raw.on('close', () => {
        clearInterval(heartbeat)
        unsubscribe()
      })
      return reply
    } catch (error) {
      return handleError(reply, deps.clock, error)
    }
  })
}

function runCommand(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
  deps: SetupRouteDependencies,
  command: 'resume' | 'discover' | 'plan' | 'diff' | 'approve' | 'apply' | 'verify',
) {
  try {
    const session = deps.auth.authenticate(request, controlScopeFor('POST', command))
    const id = request.params.sessionId ?? ''
    const body = (request.body ?? {}) as Body
    const confirmation = typeof body.confirmation === 'string' ? body.confirmation : undefined
    const force = Boolean(body.force)
    const sessionAssurance = {
      assuranceLevel: session.assuranceLevel,
      lastAuthenticatedAt: session.lastAuthenticatedAt,
    }
    const result =
      command === 'resume'
        ? deps.setup.resume(id)
        : deps.setup.run(id, command, { confirmation, force, sessionAssurance })
    return reply.send(result)
  } catch (error) {
    return handleError(reply, deps.clock, error)
  }
}

function parseCursor(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const cursor = Number.parseInt(raw ?? '0', 10)
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0
}

function handleError(reply: FastifyReply, clock: Clock, error: unknown) {
  if (error instanceof SetupCommandError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'BLOCKED'
          ? 409
          : error.code === 'TYPED_CONFIRMATION_REQUIRED' || error.code === 'STEP_UP_REQUIRED'
            ? 403
            : 422
    const code =
      error.code === 'BLOCKED'
        ? 'CONFLICT'
        : error.code === 'TYPED_CONFIRMATION_REQUIRED' || error.code === 'STEP_UP_REQUIRED'
          ? 'FORBIDDEN'
          : error.code
    return sendError(reply, clock, status, code, error.message)
  }
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
  return sendError(reply, clock, 500, 'INTERNAL_ERROR', 'Internal server error')
}

function sendError(
  reply: FastifyReply,
  clock: Clock,
  status: number,
  code:
    | 'BAD_REQUEST'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'VALIDATION_FAILED'
    | 'INTERNAL_ERROR',
  message: string,
) {
  return reply.code(status).send(
    errorEnvelope({
      code,
      message,
      retryable: status >= 500,
      correlationId: reply.request.correlationId,
      timestamp: clock.nowIso(),
    }),
  )
}
