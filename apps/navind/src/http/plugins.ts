import type { FastifyError, FastifyInstance } from 'fastify'
import { enterCorrelation } from '../correlation/context.js'
import type { Clock } from '../ports/clock.js'
import type { Logger } from '../ports/logger.js'
import { errorEnvelope, statusToErrorCode } from './errors.js'

const CORRELATION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export function isValidCorrelationId(value: string | undefined): value is string {
  return typeof value === 'string' && CORRELATION_PATTERN.test(value)
}

/**
 * Strips the query string. Query parameters frequently carry tokens or
 * credentials and must never be written to logs or error messages.
 */
export function requestPath(url: string): string {
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : url.slice(0, queryIndex)
}

export function registerCorrelation(app: FastifyInstance): void {
  app.decorateRequest('correlationId', '')
  app.decorateRequest('startTime', 0)

  app.addHook('onRequest', (request, reply, done) => {
    const correlationId = String(request.id)
    request.correlationId = correlationId
    request.startTime = Date.now()
    enterCorrelation({ correlationId })
    reply.header('x-correlation-id', correlationId)
    done()
  })
}

export function registerRequestLogging(app: FastifyInstance, logger: Logger): void {
  app.addHook('onResponse', (request, reply, done) => {
    const durationMs = Date.now() - request.startTime
    const statusCode = reply.statusCode
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info'
    logger.log(level, 'http request', {
      correlationId: request.correlationId,
      method: request.method,
      path: requestPath(request.url),
      statusCode,
      durationMs,
    })
    done()
  })
}

export function registerErrorHandling(app: FastifyInstance, logger: Logger, clock: Clock): void {
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(
      errorEnvelope({
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${requestPath(request.url)} not found`,
        retryable: false,
        correlationId: request.correlationId,
        timestamp: clock.nowIso(),
      }),
    )
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500
    const code = statusToErrorCode(statusCode)
    const serverError = statusCode >= 500

    if (serverError) {
      logger.error('request failed', {
        correlationId: request.correlationId,
        method: request.method,
        path: requestPath(request.url),
        statusCode,
        err: error,
      })
    } else {
      logger.warn('request rejected', {
        correlationId: request.correlationId,
        method: request.method,
        path: requestPath(request.url),
        statusCode,
        code,
      })
    }

    reply.status(statusCode).send(
      errorEnvelope({
        code,
        message: serverError ? 'Internal server error' : error.message,
        retryable: serverError,
        correlationId: request.correlationId,
        timestamp: clock.nowIso(),
      }),
    )
  })
}
