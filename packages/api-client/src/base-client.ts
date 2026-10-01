import type { Static, TSchema } from '@sinclair/typebox'
import type { NavinSurface } from '@navin/contracts'
import { readBoundedText, truncateText } from './body.js'
import {
  ApiClientError,
  ApiSseError,
  isApiClientError,
  mapHttpError,
  toApiClientError,
} from './errors.js'
import { assertNoReservedHeaders } from './headers.js'
import {
  assertSafePath,
  resolveOptions,
  type ApiClientOptions,
  type ResolvedApiClientOptions,
} from './options.js'
import { buildQueryString, type QueryParams } from './query.js'
import {
  computeBackoffDelayMs,
  parseRetryAfter,
  resolveRetryPolicy,
  shouldRetry,
  sleep,
  type RetryPolicy,
} from './retry.js'
import { linkSignals, throwIfAborted } from './signals.js'
import { createSseParser } from './sse.js'
import type { SseEvent, SseMessage, SseRequestOptions, SseSubscription } from './sse.js'
import type { HttpMethod } from './transport.js'
import {
  validateRequestValue,
  validateResponseValue,
  type ValidationContext,
} from './validation.js'
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled', 'abandoned'])

function hasTerminalStatus(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  for (const key of ['status', 'newStatus']) {
    if (typeof record[key] === 'string' && TERMINAL_STATUSES.has(record[key])) return true
  }
  for (const key of ['payload', 'data', 'details']) {
    if (hasTerminalStatus(record[key])) return true
  }
  return false
}

function isDefaultSseCompletion<T>(event: SseEvent<T>): boolean {
  return (
    /(?:^|[._-])(?:completed|complete|failed|cancelled|canceled|abandoned|done)(?:$|[._-])/i.test(
      event.event,
    ) || hasTerminalStatus(event.data)
  )
}

export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  headers?: Record<string, string>
  correlationId?: string
  retry?: Partial<RetryPolicy> | false
}

export interface RequestSpec extends RequestOptions {
  method: HttpMethod
  path: string
  body?: unknown
  requestSchema?: TSchema
  query?: QueryParams
  idempotencyKey?: string
  accept?: string
}

export interface JsonRequestSpec<T extends TSchema> extends RequestSpec {
  responseSchema: T
}

export interface RequestMetadata {
  correlationId: string
  requestId?: string
}

/**
 * Shared transport client. Concrete Mail/Control clients subclass this and add typed resource
 * methods; they never re-implement transport, validation, retry or streaming.
 */
export abstract class BaseApiClient {
  protected readonly options: ResolvedApiClientOptions

  constructor(options: ApiClientOptions) {
    this.options = resolveOptions(options)
  }

  get surface(): NavinSurface {
    return this.options.surface
  }

  protected buildUrl(path: string, query?: QueryParams): string {
    assertSafePath(path, 'request path')
    if (path.startsWith('//') || /^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
      throw new ApiClientError({
        code: 'CONFIGURATION_ERROR',
        message: 'Request path must be relative',
        surface: this.options.surface,
      })
    }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const queryString = buildQueryString(query)
    const base = `${this.options.baseUrl}${this.options.basePath}${normalizedPath}`
    return queryString.length > 0 ? `${base}?${queryString}` : base
  }

  protected async send<T extends TSchema>(spec: JsonRequestSpec<T>): Promise<Static<T>> {
    const { text, ...metadata } = await this.perform(spec)
    return validateResponseValue(spec.responseSchema, text, {
      surface: this.options.surface,
      correlationId: metadata.correlationId,
      requestId: metadata.requestId,
    })
  }

  protected async sendVoid(spec: RequestSpec): Promise<void> {
    await this.perform(spec)
  }

  /** Recomputes and validates auth headers. Called on every attempt so rotated tokens are used. */
  private async currentAuthHeaders(): Promise<Record<string, string>> {
    const headers = await this.options.auth.headers()
    assertNoReservedHeaders(headers, 'auth context', { isAuthContext: true })
    return headers
  }

  private buildRequestHeaders(
    spec: RequestSpec,
    correlationId: string,
    authHeaders: Record<string, string>,
    hasBody: boolean,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.options.defaultHeaders,
      ...(spec.headers ?? {}),
      ...authHeaders,
    }
    headers.accept = spec.accept ?? 'application/json'
    headers['x-navin-surface'] = this.options.surface
    headers['x-correlation-id'] = correlationId
    if (this.options.userAgent) headers['user-agent'] = this.options.userAgent
    if (hasBody) headers['content-type'] = 'application/json'
    if (spec.idempotencyKey !== undefined) headers['idempotency-key'] = spec.idempotencyKey
    return headers
  }

  private async perform(spec: RequestSpec): Promise<{ text: string } & RequestMetadata> {
    assertNoReservedHeaders(spec.headers, 'request options.headers')
    const policy = resolveRetryPolicy(spec.retry, this.options.retry)
    const timeoutMs = spec.timeoutMs ?? this.options.timeoutMs
    const correlationId = spec.correlationId ?? this.options.correlationIdFactory()
    const url = this.buildUrl(spec.path, spec.query)

    let bodyText: string | undefined
    if (spec.body !== undefined) {
      const validated = spec.requestSchema
        ? validateRequestValue(spec.requestSchema, spec.body, {
            surface: this.options.surface,
            correlationId,
          })
        : spec.body
      bodyText = JSON.stringify(validated)
    }

    const hasIdempotencyKey = spec.idempotencyKey !== undefined
    const maxAttempts = policy ? policy.maxAttempts : 1
    let lastError: ApiClientError | undefined

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      throwIfAborted(spec.signal)
      const linked = linkSignals(spec.signal, timeoutMs)
      let retryAfterMs: number | undefined
      try {
        const authHeaders = await this.currentAuthHeaders()
        const headers = this.buildRequestHeaders(
          spec,
          correlationId,
          authHeaders,
          bodyText !== undefined,
        )
        const response = await this.options.transport.send({
          method: spec.method,
          url,
          headers,
          body: bodyText,
          signal: linked.signal,
          credentials: this.options.credentials ?? this.options.auth.credentials,
        })
        const requestId = response.headers.get('x-request-id') ?? undefined
        const context = { surface: this.options.surface, correlationId, requestId }
        if (!response.ok) {
          const raw = await readBoundedText(response, this.options.maxResponseBytes, context)
          retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
          throw mapHttpError(
            response.status,
            truncateText(raw, this.options.maxErrorBodyBytes),
            context,
          )
        }
        const text = await readBoundedText(response, this.options.maxResponseBytes, context)
        linked.dispose()
        return { text, correlationId, requestId }
      } catch (error) {
        const apiError = toApiClientError(error, {
          surface: this.options.surface,
          correlationId,
          timedOut: linked.timedOut(),
          signal: spec.signal,
        })
        linked.dispose()
        const canRetry =
          policy !== undefined &&
          attempt < maxAttempts &&
          shouldRetry(apiError, policy, spec.method, hasIdempotencyKey)
        if (!canRetry) throw apiError
        lastError = apiError
        await sleep(computeBackoffDelayMs(attempt, policy, retryAfterMs), spec.signal)
      }
    }

    throw (
      lastError ??
      new ApiClientError({
        code: 'INTERNAL_ERROR',
        message: 'Request failed without a captured error',
        surface: this.options.surface,
      })
    )
  }

  protected stream<T extends TSchema>(options: SseRequestOptions<T>): SseSubscription {
    assertNoReservedHeaders(options.headers, 'SSE options.headers')

    const surface = this.options.surface
    const outer = new AbortController()
    const external = options.signal
    const onExternalAbort = (): void => {
      outer.abort(external?.reason)
    }
    if (external) {
      if (external.aborted) outer.abort(external.reason)
      else external.addEventListener('abort', onExternalAbort, { once: true })
    }

    let closed = false
    let lastEventId = options.lastEventId
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let resolveDone: () => void = () => undefined
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })

    const close = (): void => {
      if (closed) return
      closed = true
      void activeReader?.cancel().catch(() => undefined)
      outer.abort()
    }

    // Callback boundaries: user callbacks must never break the loop or leak a rejection.
    const reportError = (error: ApiClientError): boolean => {
      try {
        options.onError?.(error)
        return false
      } catch {
        // A throwing callback closes the subscription, preventing a leaked stream.
        return true
      }
    }
    const invoke = (callback: (() => void) | undefined): boolean => {
      if (!callback) return true
      try {
        callback()
        return true
      } catch {
        // Lifecycle callback failures are contained and trigger cleanup.
        return false
      }
    }

    const run = async (): Promise<void> => {
      try {
        const url = this.buildUrl(options.path, options.query)
        const policy = resolveRetryPolicy(options.retry, this.options.retry)
        let failedAttempts = 0

        while (!closed && !outer.signal.aborted) {
          const linked = linkSignals(outer.signal, this.options.timeoutMs)
          let serverRetryMs: number | undefined
          try {
            const authHeaders = await this.currentAuthHeaders()
            const headers: Record<string, string> = {
              ...this.options.defaultHeaders,
              ...(options.headers ?? {}),
              ...authHeaders,
            }
            headers.accept = 'text/event-stream'
            headers['cache-control'] = 'no-cache'
            headers['x-navin-surface'] = surface
            if (this.options.userAgent) headers['user-agent'] = this.options.userAgent
            if (lastEventId !== undefined) headers['last-event-id'] = lastEventId

            const response = await this.options.transport.send({
              method: 'GET',
              url,
              headers,
              signal: linked.signal,
              credentials: this.options.credentials ?? this.options.auth.credentials,
            })
            const requestId = response.headers.get('x-request-id') ?? undefined
            const context: ValidationContext = { surface, requestId }
            if (!response.ok) {
              const raw = await readBoundedText(response, this.options.maxErrorBodyBytes, context)
              throw mapHttpError(
                response.status,
                truncateText(raw, this.options.maxErrorBodyBytes),
                {
                  surface,
                  requestId,
                },
              )
            }
            linked.clearTimeout()
            if (
              !invoke(() =>
                options.onOpen?.({ status: response.status, headers: response.headers }),
              )
            ) {
              close()
              break
            }

            const body = response.body
            if (!body) throw new ApiSseError('SSE response has no body', { surface, requestId })
            const reader = body.getReader()
            activeReader = reader
            const decoder = new TextDecoder()
            const parser = createSseParser(this.options.maxSseEventBytes)
            try {
              for (;;) {
                const { value, done: streamDone } = await reader.read()
                if (streamDone) break
                const chunk = decoder.decode(value, { stream: true })
                for (const message of parser.push(chunk)) {
                  if (message.retry !== undefined) serverRetryMs = message.retry
                  if (message.id !== undefined) lastEventId = message.id
                  failedAttempts = 0
                  const shouldStop = this.emitSse(options, message, context, reportError)
                  if (shouldStop) {
                    close()
                    break
                  }
                }
                if (closed || outer.signal.aborted) break
              }
            } finally {
              activeReader = undefined
              try {
                reader.releaseLock()
              } catch {
                // Reader may already be released when the stream aborts.
              }
            }
            linked.dispose()
            if (closed || outer.signal.aborted) break
            failedAttempts += 1
            if (policy && failedAttempts >= policy.maxAttempts) break
            const delay = policy
              ? computeBackoffDelayMs(failedAttempts, policy, serverRetryMs)
              : 1_000
            await sleep(delay, outer.signal)
          } catch (error) {
            linked.dispose()
            if (closed || outer.signal.aborted) break
            const apiError = toApiClientError(error, {
              surface,
              timedOut: linked.timedOut(),
              signal: outer.signal,
            })
            if (reportError(apiError)) {
              close()
              break
            }
            if (!policy || !shouldRetry(apiError, policy, 'GET', false)) break
            failedAttempts += 1
            if (failedAttempts >= policy.maxAttempts) break
            await sleep(computeBackoffDelayMs(failedAttempts, policy), outer.signal)
          }
        }
      } catch (error) {
        if (!closed && !outer.signal.aborted) {
          const callbackFailed = reportError(
            toApiClientError(error, { surface, signal: outer.signal }),
          )
          if (callbackFailed) close()
        }
      } finally {
        closed = true
        external?.removeEventListener('abort', onExternalAbort)
        invoke(() => options.onClose?.())
        resolveDone()
      }
    }

    void run()

    return {
      close,
      get closed() {
        return closed
      },
      get lastEventId() {
        return lastEventId
      },
      done,
    }
  }

  private emitSse<T extends TSchema>(
    options: SseRequestOptions<T>,
    message: SseMessage,
    context: ValidationContext,
    reportError: (error: ApiClientError) => boolean,
  ): boolean {
    let data: Static<T>
    try {
      data = validateResponseValue(options.schema, message.data, context)
    } catch (error) {
      const callbackFailed = reportError(
        isApiClientError(error)
          ? error
          : new ApiSseError('Failed to process SSE event', {
              surface: context.surface,
              cause: error,
            }),
      )
      return callbackFailed
    }
    const event: SseEvent<Static<T>> = { id: message.id, event: message.event, data }
    try {
      options.onEvent?.(event)
    } catch (error) {
      reportError(
        new ApiSseError('SSE event handler threw', { surface: context.surface, cause: error }),
      )
      return true
    }
    try {
      return options.isComplete?.(event) ?? isDefaultSseCompletion(event)
    } catch (error) {
      reportError(
        new ApiSseError('SSE completion handler threw', { surface: context.surface, cause: error }),
      )
      return true
    }
  }
}
