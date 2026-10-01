import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Value } from '@sinclair/typebox/value'
import { MAIL_SCOPES, isAuthError } from '@navin/auth'
import {
  MailMutationRequestSchema,
  MailQueryRequestSchema,
  MailSubmissionRequestSchema,
  type MailMutationRequest,
  type MailQueryRequest,
  type MailSubmissionRequest,
} from '@navin/contracts'
import { isGatewayError, type NormalizedSession } from '@navin/mail-gateway'
import { errorEnvelope, type HttpErrorCode } from '../http/errors.js'
import type { Clock } from '../ports/clock.js'
import type { MailAuthorization } from './auth.js'
import type { MailService } from './service.js'

export interface MailRouteDependencies {
  mail: MailService
  auth: MailAuthorization
  clock: Clock
}

interface AccountQuery {
  accountId?: string
}

interface MessageParams {
  messageId?: string
}

interface ThreadParams {
  threadId?: string
}

type GuardedHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown

export function registerMailRoutes(app: FastifyInstance, deps: MailRouteDependencies): void {
  const guard = (handler: GuardedHandler) => guarded(deps, handler)

  // Mail identity: separate relying party, host-only session, mail surface.
  app.post('/api/v1/mail/auth/login', guard(loginHandler(deps)))
  app.get('/api/v1/mail/auth/session', guard(mailSessionHandler(deps)))
  app.post('/api/v1/mail/auth/logout', guard(logoutHandler(deps)))

  // Upstream engine access, all credential-isolated behind the BFF.
  app.get('/api/v1/mail/session', guard(readSessionHandler(deps)))
  app.get<{ Querystring: AccountQuery }>(
    '/api/v1/mail/mailboxes',
    guard(listMailboxesHandler(deps)),
  )
  app.get<{ Params: MessageParams; Querystring: AccountQuery }>(
    '/api/v1/mail/messages/:messageId',
    guard(getMessageHandler(deps)),
  )
  app.get<{ Params: ThreadParams; Querystring: AccountQuery }>(
    '/api/v1/mail/threads/:threadId',
    guard(getThreadHandler(deps)),
  )
  app.post('/api/v1/mail/query', guard(queryHandler(deps)))
  app.post('/api/v1/mail/mutations', guard(mutateHandler(deps)))
  app.post('/api/v1/mail/submissions', guard(submitHandler(deps)))
  app.get('/api/v1/mail/events', guard(eventsHandler(deps)))
}

function loginHandler(deps: MailRouteDependencies): GuardedHandler {
  return (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const email = typeof body.email === 'string' ? body.email : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) {
      return sendError(
        reply,
        deps.clock,
        400,
        'VALIDATION_FAILED',
        'Email and password are required',
      )
    }
    const issued = deps.auth.login({ email, password })
    return reply.header('set-cookie', issued.cookie).send({
      principal: issued.principal,
      token: issued.token,
      expiresAt: issued.expiresAt,
    })
  }
}

function mailSessionHandler(deps: MailRouteDependencies): GuardedHandler {
  return (request, reply) => {
    const session = deps.auth.authenticate(request, MAIL_SCOPES.read)
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
  }
}

function logoutHandler(deps: MailRouteDependencies): GuardedHandler {
  return (request, reply) => {
    const session = deps.auth.authenticate(request, MAIL_SCOPES.read)
    const cleared = deps.auth.logout(session)
    return reply.header('set-cookie', cleared).send({ loggedOut: true })
  }
}

function readSessionHandler(deps: MailRouteDependencies): GuardedHandler {
  return async (request, reply) => {
    const session = deps.auth.authenticate(request, MAIL_SCOPES.read)
    const normalized = await deps.mail.getSession(context(request, session))
    return reply.send(toSessionResponse(normalized, deps.mail.sender))
  }
}

function listMailboxesHandler(deps: MailRouteDependencies): GuardedHandler {
  return async (request, reply) => {
    const session = deps.auth.authenticate(request, MAIL_SCOPES.read)
    const accountId = requireAccountId(request as FastifyRequest<{ Querystring: AccountQuery }>)
    const mailboxes = await deps.mail.listMailboxes(context(request, session), accountId)
    return reply.send({ mailboxes })
  }
}

function getMessageHandler(deps: MailRouteDependencies): GuardedHandler {
  return async (request, reply) => {
    const session = deps.auth.authenticate(request, MAIL_SCOPES.read)
    const { accountId, messageId } = requireMessageTarget(
      request as FastifyRequest<{ Params: MessageParams; Querystring: AccountQuery }>,
    )
    const message = await deps.mail.getEmail(context(request, session), accountId, messageId)
    return reply.send(message)
  }
}

function getThreadHandler(deps: MailRouteDependencies): GuardedHandler {
  return async (request, reply) => {
    const session = deps.auth.authenticate(request, MAIL_SCOPES.read)
    const { accountId, threadId } = requireThreadTarget(
      request as FastifyRequest<{ Params: ThreadParams; Querystring: AccountQuery }>,
    )
    const thread = await deps.mail.getThread(context(request, session), accountId, threadId)
    return reply.send(thread)
  }
}

function queryHandler(deps: MailRouteDependencies): GuardedHandler {
  return async (request, reply) => {
    const session = deps.auth.authenticate(request, MAIL_SCOPES.read)
    const body = (request.body ?? {}) as Record<string, unknown>
    if (!Value.Check(MailQueryRequestSchema, body)) {
      return sendError(reply, deps.clock, 400, 'VALIDATION_FAILED', 'Invalid mail query request')
    }
    const response = await deps.mail.query(context(request, session), body as MailQueryRequest)
    return reply.send(response)
  }
}

function mutateHandler(deps: MailRouteDependencies): GuardedHandler {
  return async (request, reply) => {
    const session = deps.auth.authenticate(request, MAIL_SCOPES.write)
    const body = (request.body ?? {}) as Record<string, unknown>
    if (!Value.Check(MailMutationRequestSchema, body)) {
      return sendError(reply, deps.clock, 400, 'VALIDATION_FAILED', 'Invalid mail mutation request')
    }
    const response = await deps.mail.mutate(context(request, session), body as MailMutationRequest)
    return reply.send(response)
  }
}

function submitHandler(deps: MailRouteDependencies): GuardedHandler {
  return async (request, reply) => {
    const session = deps.auth.authenticate(request, MAIL_SCOPES.send)
    const body = (request.body ?? {}) as Record<string, unknown>
    if (!Value.Check(MailSubmissionRequestSchema, body)) {
      return sendError(
        reply,
        deps.clock,
        400,
        'VALIDATION_FAILED',
        'Invalid mail submission request',
      )
    }
    const response = await deps.mail.submit(
      context(request, session),
      body as MailSubmissionRequest,
    )
    return reply.send(response)
  }
}

function eventsHandler(deps: MailRouteDependencies): GuardedHandler {
  return (request, reply) => {
    deps.auth.authenticate(request, MAIL_SCOPES.read)
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
      raw.write(`id: ${stored.seq}\nevent: mail\ndata: ${JSON.stringify(stored.event)}\n\n`)
    }
    for (const event of deps.mail.events.eventsSince(cursor)) write(event)
    const unsubscribe = deps.mail.events.subscribe(write)
    const heartbeat = setInterval(() => raw.write(': keep-alive\n\n'), 15000)
    heartbeat.unref()
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
    return reply
  }
}

function guarded(deps: MailRouteDependencies, handler: GuardedHandler): GuardedHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    if (!deps.mail.configured) {
      return sendError(
        reply,
        deps.clock,
        503,
        'SERVICE_UNAVAILABLE',
        'Mail is not configured on this Navin deployment',
      )
    }
    try {
      return await handler(request, reply)
    } catch (error) {
      return handleMailError(reply, deps.clock, error)
    }
  }
}

function context(request: FastifyRequest, session: { sessionId: string; userId: string }) {
  return {
    sessionId: session.sessionId,
    actorId: session.userId,
    requestId: request.correlationId,
  }
}

function toSessionResponse(
  session: NormalizedSession,
  sender: { identityId: string; address: string } | null,
) {
  return {
    username: session.username,
    state: session.state,
    accounts: session.accounts,
    primaryAccountId: session.primaryAccountId,
    capabilities: {
      mail: session.capabilities.mail,
      submission: session.capabilities.submission,
      vacation: session.capabilities.vacation,
      contacts: session.capabilities.contacts,
      calendars: session.capabilities.calendars,
      scheduledSend: session.capabilities.scheduledSend,
    },
    sender,
  }
}

function requireAccountId(request: FastifyRequest<{ Querystring: AccountQuery }>): string {
  const accountId = request.query.accountId
  if (!accountId) throw new MailRequestError('BAD_REQUEST', 'accountId query parameter is required')
  return accountId
}

function requireMessageTarget(
  request: FastifyRequest<{ Params: MessageParams; Querystring: AccountQuery }>,
): { accountId: string; messageId: string } {
  const accountId = requireAccountId(request)
  const messageId = request.params.messageId
  if (!messageId) throw new MailRequestError('BAD_REQUEST', 'messageId path parameter is required')
  return { accountId, messageId }
}

function requireThreadTarget(
  request: FastifyRequest<{ Params: ThreadParams; Querystring: AccountQuery }>,
): { accountId: string; threadId: string } {
  const accountId = requireAccountId(request)
  const threadId = request.params.threadId
  if (!threadId) throw new MailRequestError('BAD_REQUEST', 'threadId path parameter is required')
  return { accountId, threadId }
}

class MailRequestError extends Error {
  constructor(
    readonly code: HttpErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MailRequestError'
  }
}

function parseCursor(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const cursor = Number.parseInt(raw ?? '0', 10)
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0
}

function handleMailError(reply: FastifyReply, clock: Clock, error: unknown) {
  if (error instanceof MailRequestError) {
    return sendError(reply, clock, 400, error.code, error.message)
  }
  if (isGatewayError(error)) {
    return sendError(
      reply,
      clock,
      error.httpStatus,
      error.code as HttpErrorCode,
      error.message,
      error.retryable,
      error.details,
    )
  }
  if (isAuthError(error)) {
    const status =
      error.code === 'INVALID_CREDENTIALS' ||
      error.code === 'INVALID_TOKEN' ||
      error.code === 'TOKEN_EXPIRED' ||
      error.code === 'SESSION_NOT_FOUND' ||
      error.code === 'SESSION_REVOKED' ||
      error.code === 'ACCOUNT_DISABLED' ||
      error.code === 'WRONG_AUDIENCE'
        ? 401
        : error.code === 'FORBIDDEN' || error.code === 'INSUFFICIENT_SCOPE'
          ? 403
          : 400
    return sendError(
      reply,
      clock,
      status,
      status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : 'VALIDATION_FAILED',
      error.message,
    )
  }
  return sendError(reply, clock, 500, 'INTERNAL_ERROR', 'Internal server error')
}

function sendError(
  reply: FastifyReply,
  clock: Clock,
  status: number,
  code: HttpErrorCode,
  message: string,
  retryable = status >= 500,
  details?: Record<string, unknown>,
) {
  return reply.code(status).send(
    errorEnvelope({
      code,
      message,
      retryable,
      correlationId: reply.request.correlationId,
      timestamp: clock.nowIso(),
      ...(details ? { details } : {}),
    }),
  )
}
