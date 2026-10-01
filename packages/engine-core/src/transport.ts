import { randomUUID } from 'node:crypto'
import { EngineError, extractErrorMessage, normalizeEngineError } from './errors.js'
import { combineAbortSignals, createTimeoutSignal, sleep } from './signals.js'

export type FetchLike = typeof fetch

export interface AuthProvider {
  readonly scheme: string
  apply(headers: Headers): void
  redacted(): Record<string, string>
}

export class BearerTokenAuth implements AuthProvider {
  readonly scheme = 'bearer'
  private readonly token: string

  constructor(token: string) {
    if (token.length === 0) {
      throw new EngineError({ category: 'validation', message: 'Bearer token must not be empty' })
    }
    this.token = token
  }

  apply(headers: Headers): void {
    headers.set('authorization', `Bearer ${this.token}`)
  }

  redacted(): Record<string, string> {
    return { authorization: 'Bearer [REDACTED]' }
  }
}

export class BasicAuth implements AuthProvider {
  readonly scheme = 'basic'
  private readonly encoded: string

  constructor(username: string, password: string) {
    if (username.length === 0) {
      throw new EngineError({ category: 'validation', message: 'Basic auth username is required' })
    }
    this.encoded = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
  }

  apply(headers: Headers): void {
    headers.set('authorization', `Basic ${this.encoded}`)
  }

  redacted(): Record<string, string> {
    return { authorization: 'Basic [REDACTED]' }
  }
}

export const noAuth: AuthProvider = {
  scheme: 'none',
  apply: () => undefined,
  redacted: () => ({}),
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return host === '127.0.0.1' || host === '::1'
}

export interface RetryPolicy {
  attempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export interface HttpTransportOptions {
  baseUrl: string
  auth?: AuthProvider
  defaultTimeoutMs?: number
  maxResponseBytes?: number
  allowInsecureHttp?: boolean
  fetchImpl?: FetchLike
  retry?: Partial<RetryPolicy>
  userAgent?: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface TransportRequest {
  method: HttpMethod
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
}

export interface TransportCallOptions {
  signal?: AbortSignal
  timeoutMs?: number
  idempotencyKey?: string
  requestId?: string
  headers?: Record<string, string>
}

export interface TransportResponse<T> {
  status: number
  headers: Headers
  data: T
  requestId: string
  durationMs: number
  attempts: number
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000
const DEFAULT_RETRY: RetryPolicy = { attempts: 2, baseDelayMs: 200, maxDelayMs: 2_000 }

function categoryForStatus(status: number): EngineError['category'] {
  if (status === 400 || status === 422) return 'validation'
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'unavailable'
  return 'protocol'
}

function rawAuthorityHost(authority: string): string {
  if (authority.length === 0 || authority.includes('@')) {
    invalidUrl('Engine endpoint must not contain credentials or an empty host')
  }
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end < 0) invalidUrl('Engine endpoint contains an invalid IPv6 host')
    const host = authority.slice(0, end + 1)
    const suffix = authority.slice(end + 1)
    if (suffix.length > 0 && !/^:\d+$/.test(suffix)) {
      invalidUrl('Engine endpoint contains an invalid port')
    }
    return host
  }
  const separator = authority.lastIndexOf(':')
  if (separator >= 0) {
    const host = authority.slice(0, separator)
    const port = authority.slice(separator + 1)
    if (host.length === 0 || !/^\d+$/.test(port))
      invalidUrl('Engine endpoint contains an invalid port')
    return host
  }
  return authority
}

function parseSecureEndpoint(raw: string): URL {
  if (raw.trim() !== raw || [...raw].some((character) => character.charCodeAt(0) <= 0x20)) {
    invalidUrl('Engine endpoint must be an absolute URL without whitespace')
  }
  const match = /^(https?):\/\/([^/?#]*)([^?#]*)?(?:[?#].*)?$/i.exec(raw)
  if (!match) invalidUrl(`Engine endpoint must be an absolute HTTP(S) URL: ${raw}`)
  const scheme = match[1]?.toLowerCase()
  const authority = match[2] ?? ''
  const rawHost = rawAuthorityHost(authority)
  const rawPath = match[3] ?? ''
  validatePath(rawPath, 'engine endpoint path')

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    invalidUrl(`Invalid engine endpoint: ${raw}`)
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    invalidUrl('Engine endpoint must not contain credentials, query parameters, or a hash')
  }
  if (parsed.protocol !== `${scheme}:`)
    invalidUrl(`Unsupported engine endpoint scheme: ${parsed.protocol}`)

  const normalizedRawHost = rawHost.toLowerCase()
  const normalizedParsedHost = parsed.hostname.toLowerCase()
  if (normalizedRawHost !== normalizedParsedHost && /^\d/.test(rawHost)) {
    invalidUrl('Engine endpoint host uses an ambiguous numeric representation')
  }
  if (normalizedRawHost === 'localhost' || normalizedRawHost.endsWith('.localhost')) {
    invalidUrl('Engine endpoint must not use an ambiguous localhost hostname')
  }
  if (
    parsed.protocol === 'http:' &&
    normalizedRawHost !== '127.0.0.1' &&
    normalizedRawHost !== '[::1]'
  ) {
    invalidUrl('Refusing insecure HTTP engine endpoint; only literal loopback IPs are allowed', {
      host: parsed.hostname,
    })
  }
  return parsed
}

function invalidUrl(message: string, details?: Record<string, unknown>): never {
  throw new EngineError({ category: 'validation', message, details })
}

function validatePath(path: string, label: string): void {
  if (path.length === 0) return
  if (
    /[\\?#]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) <= 0x20) ||
    /%(?:2e|2f|5c|3f|23)/i.test(path)
  ) {
    invalidUrl(`Unsafe ${label}: ${path}`)
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    invalidUrl(`Malformed ${label}: ${path}`)
  }
  if (decoded.includes('\\') || decoded.split('/').some((part) => part === '.' || part === '..')) {
    invalidUrl(`Traversal is not allowed in ${label}: ${path}`)
  }
  if (path.startsWith('//') || path.includes('://')) {
    invalidUrl(`Ambiguous ${label}: ${path}`)
  }
}
const RESERVED_HEADERS = new Set([
  'accept',
  'authorization',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'forwarded',
  'host',
  'idempotency-key',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
])
function assertHeaderIsNotReserved(key: string): void {
  if (RESERVED_HEADERS.has(key.toLowerCase())) {
    throw new EngineError({
      category: 'validation',
      message: `Header is reserved by engine transport: ${key}`,
    })
  }
}

function joinPaths(base: string, path: string): string {
  validatePath(path, 'request path')
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const suffix = path.startsWith('/') ? path : `/${path}`
  const joined = `${trimmedBase}${suffix}`
  return joined.length === 0 ? '/' : joined
}

function parseBody(response: Response, text: string): unknown {
  if (text.length === 0) return undefined
  const contentType = response.headers.get('content-type') ?? ''
  const looksJson = contentType.includes('json') || /^\s*[[{]/.test(text)
  if (!looksJson) return text
  try {
    return JSON.parse(text)
  } catch {
    throw new EngineError({
      category: 'protocol',
      message: 'Engine returned a malformed JSON response',
      status: response.status,
    })
  }
}

async function readLimitedText(
  response: Response,
  maxBytes: number,
  requestId: string,
): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (Number.isFinite(size) && size > maxBytes) {
      throw new EngineError({
        category: 'protocol',
        message: `Engine response exceeded ${maxBytes} bytes`,
        status: response.status,
        requestId,
      })
    }
  }

  const body = response.body
  if (!body) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new EngineError({
        category: 'protocol',
        message: `Engine response exceeded ${maxBytes} bytes`,
        status: response.status,
        requestId,
      })
    }
    return text
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new EngineError({
          category: 'protocol',
          message: `Engine response exceeded ${maxBytes} bytes`,
          status: response.status,
          requestId,
        })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

export class HttpTransport {
  readonly baseUrl: URL
  readonly auth: AuthProvider
  readonly secure: boolean
  private readonly defaultTimeoutMs: number
  private readonly maxResponseBytes: number
  private readonly fetchImpl: FetchLike
  private readonly retry: RetryPolicy
  private readonly userAgent: string

  constructor(options: HttpTransportOptions) {
    const parsed = parseSecureEndpoint(options.baseUrl)

    this.baseUrl = parsed
    this.secure = parsed.protocol === 'https:'
    this.auth = options.auth ?? noAuth
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
    this.fetchImpl = options.fetchImpl ?? fetch
    this.retry = { ...DEFAULT_RETRY, ...options.retry }
    this.userAgent = options.userAgent ?? '@navin/engine-core'
  }

  async request<T>(
    request: TransportRequest,
    options: TransportCallOptions = {},
  ): Promise<TransportResponse<T>> {
    const requestId = options.requestId ?? randomUUID()
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const url = this.buildUrl(request)
    const idempotent = request.method === 'GET' || options.idempotencyKey !== undefined
    const maxAttempts = idempotent ? Math.max(1, this.retry.attempts) : 1

    let lastError: EngineError | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.attempt<T>(url, request, options, requestId, timeoutMs)
        return { ...result, attempts: attempt }
      } catch (error) {
        const engineError = normalizeEngineError(error, { requestId })
        lastError = engineError
        const canRetry =
          idempotent &&
          attempt < maxAttempts &&
          engineError.retryable &&
          options.signal?.aborted !== true
        if (!canRetry) throw engineError
        await this.delay(attempt, options.signal)
      }
    }

    throw lastError ?? new EngineError({ category: 'internal', message: 'Engine request failed' })
  }

  private buildUrl(request: TransportRequest): string {
    const url = new URL(this.baseUrl.toString())
    url.pathname = joinPaths(this.baseUrl.pathname, request.path)
    url.search = ''
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value === undefined) continue
      url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private buildHeaders(request: TransportRequest, options: TransportCallOptions): Headers {
    const headers = new Headers()
    headers.set('accept', 'application/json')
    headers.set('user-agent', this.userAgent)
    if (request.body !== undefined) headers.set('content-type', 'application/json')
    this.auth.apply(headers)
    if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey)
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      assertHeaderIsNotReserved(key)
      headers.set(key, value)
    }
    return headers
  }

  private async attempt<T>(
    url: string,
    request: TransportRequest,
    options: TransportCallOptions,
    requestId: string,
    timeoutMs: number,
  ): Promise<Omit<TransportResponse<T>, 'attempts'>> {
    const timeout = createTimeoutSignal(timeoutMs)
    const combined = combineAbortSignals([options.signal, timeout.signal])
    const headers = this.buildHeaders(request, options)
    const started = Date.now()
    try {
      const response = await this.fetchImpl(url, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: combined.signal,
        redirect: 'manual',
      })
      const text = await readLimitedText(response, this.maxResponseBytes, requestId)
      const durationMs = Date.now() - started
      const data = parseBody(response, text) as T
      if (!response.ok) {
        throw this.errorFromResponse(response.status, data, text, requestId)
      }
      return { status: response.status, headers: response.headers, data, requestId, durationMs }
    } catch (error) {
      throw normalizeEngineError(error, { requestId, timedOut: timeout.timedOut() })
    } finally {
      combined.clear()
      timeout.clear()
    }
  }

  private errorFromResponse(
    status: number,
    data: unknown,
    text: string,
    requestId: string,
  ): EngineError {
    const category = categoryForStatus(status)
    const message = extractErrorMessage(data, text.trim() || `Engine responded with HTTP ${status}`)
    return new EngineError({
      category,
      message,
      status,
      requestId,
      retryable: status === 429 || status === 408 || status === 504 || status >= 500,
      details: { httpStatus: status },
    })
  }

  private async delay(attempt: number, signal?: AbortSignal): Promise<void> {
    const base = this.retry.baseDelayMs * 2 ** (attempt - 1)
    const jitter = Math.floor(Math.random() * this.retry.baseDelayMs)
    const wait = Math.min(base + jitter, this.retry.maxDelayMs)
    await sleep(wait, signal)
  }
}
