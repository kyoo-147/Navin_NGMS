import { GatewayError, gatewayErrorFromHttpStatus } from '../errors.js'
import { isRecord } from './types.js'
import { assertJmapResponseUrl, validateJmapUrl } from './url-policy.js'

export interface JmapTransportRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  allowedOrigin?: string
}

export interface JmapTransportResponse {
  status: number
  headers: Headers
  json: unknown
}

export interface JmapTransport {
  send(request: JmapTransportRequest): Promise<JmapTransportResponse>
}

export interface JmapHttpTransportOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

interface TimeoutSignal {
  signal: AbortSignal
  didTimeout: () => boolean
  cleanup: () => void
}

function createTimeoutSignal(external: AbortSignal | undefined, timeoutMs: number): TimeoutSignal {
  const controller = new AbortController()
  let timedOut = false

  const onExternalAbort = (): void => controller.abort(external?.reason)
  if (external) {
    if (external.aborted) controller.abort(external.reason)
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('jmap-request-timeout'))
  }, timeoutMs)
  if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}

function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    (cause as { name?: string }).name === 'AbortError'
  )
}

function extractProblemDetail(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const detail = payload['detail']
  const type = payload['type']
  if (typeof detail === 'string' && detail.length > 0) return detail
  if (typeof type === 'string' && type.length > 0) return `JMAP request rejected: ${type}`
  return undefined
}

/**
 * Thin fetch-based transport for a JMAP endpoint.
 *
 * Every request is bounded by a timeout and optionally an external abort
 * signal. The upstream credential is passed in per-request and is never logged
 * or embedded into thrown errors.
 */
export class JmapHttpTransport implements JmapTransport {
  private readonly fetchImpl: typeof fetch
  private readonly defaultTimeoutMs: number

  constructor(options: JmapHttpTransportOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.defaultTimeoutMs = options.timeoutMs ?? 30_000
    if (typeof this.fetchImpl !== 'function') {
      throw new GatewayError({
        code: 'INTERNAL_ERROR',
        message: 'No fetch implementation available for JMAP transport',
      })
    }
  }

  async send(request: JmapTransportRequest): Promise<JmapTransportResponse> {
    const requestedUrl = validateJmapUrl(request.url)
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs
    const bounded = createTimeoutSignal(request.signal, timeoutMs)
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...request.headers,
    }

    let response: Response
    try {
      response = await this.fetchImpl(request.url, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: bounded.signal,
        redirect: 'error',
      })
    } catch (cause) {
      if (bounded.didTimeout()) {
        throw new GatewayError({
          code: 'SERVICE_UNAVAILABLE',
          message: `Upstream JMAP request timed out after ${timeoutMs}ms`,
          retryable: true,
          httpStatus: 504,
          details: { reason: 'timeout', timeoutMs },
          cause,
        })
      }
      if (isAbortError(cause) || request.signal?.aborted) {
        throw new GatewayError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Upstream JMAP request was aborted',
          retryable: true,
          httpStatus: 499,
          details: { reason: 'aborted' },
          cause,
        })
      }
      throw new GatewayError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Upstream JMAP request failed before a response was received',
        retryable: true,
        httpStatus: 502,
        details: { reason: 'network' },
        cause,
      })
    } finally {
      bounded.cleanup()
    }

    assertJmapResponseUrl(response.url, requestedUrl.toString())
    if (request.allowedOrigin && requestedUrl.origin !== request.allowedOrigin) {
      throw new GatewayError({
        code: 'VALIDATION_FAILED',
        message: 'JMAP request origin is outside the validated session origin',
        details: { reason: 'origin-mismatch' },
      })
    }

    const text = await response.text()
    let json: unknown
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown
      } catch {
        json = undefined
      }
    }

    if (!response.ok) {
      throw gatewayErrorFromHttpStatus(response.status, extractProblemDetail(json))
    }

    return { status: response.status, headers: response.headers, json }
  }
}
