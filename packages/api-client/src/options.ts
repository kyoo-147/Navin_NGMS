import type { IdempotencyKey, NavinSurface } from '@navin/contracts'
import { anonymousAuthContext, type AuthContext } from './auth.js'
import { ApiConfigurationError } from './errors.js'
import { assertNoReservedHeaders } from './headers.js'
import { createCorrelationId, createIdempotencyKey } from './ids.js'
import { mergeRetryPolicy, type RetryPolicy } from './retry.js'
import { FetchTransport, type HttpTransport, type RequestCredentials } from './transport.js'
import { API_BASE_PATH } from './routes.js'

function isCanonicalDecimalOctet(value: string): boolean {
  return /^(?:0|[1-9]\d{0,2})$/.test(value) && Number(value) <= 255
}

function isCanonicalLoopbackAuthority(raw: string, schemeEnd: number): boolean {
  const authorityStart = schemeEnd + 3
  const suffixStart = raw.slice(authorityStart).search(/[/?#]/)
  const authority = raw.slice(
    authorityStart,
    suffixStart === -1 ? raw.length : authorityStart + suffixStart,
  )
  if (authority.includes('@')) return false

  let host = authority
  const portSeparator = authority.lastIndexOf(':')
  if (portSeparator >= 0 && !authority.startsWith('[')) {
    host = authority.slice(0, portSeparator)
    const port = authority.slice(portSeparator + 1)
    if (!/^\d+$/.test(port)) return false
  } else if (authority.startsWith('[')) {
    const closeBracket = authority.indexOf(']')
    if (closeBracket === -1) return false
    host = authority.slice(0, closeBracket + 1)
    const port = authority.slice(closeBracket + 1)
    if (port.length > 0 && !/^:\d+$/.test(port)) return false
  }

  if (host === '[::1]') return true
  const octets = host.split('.')
  return (
    octets.length === 4 && octets[0] === '127' && octets.slice(1).every(isCanonicalDecimalOctet)
  )
}

export function assertSafePath(value: string, source: string): void {
  if (
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\') ||
    [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    })
  ) {
    throw new ApiConfigurationError(
      `${source} must be a path without query, fragment, or control characters`,
    )
  }

  let decoded = value
  for (let pass = 0; pass < 3; pass += 1) {
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch (error) {
      throw new ApiConfigurationError(`${source} contains malformed percent encoding`, {
        cause: error,
      })
    }
    if (next === decoded) break
    decoded = next
  }

  if (
    decoded.includes('\\') ||
    decoded.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new ApiConfigurationError(`${source} must not contain path traversal`)
  }
}

export interface ApiClientOptions {
  baseUrl: string
  surface: NavinSurface
  auth?: AuthContext
  transport?: HttpTransport
  fetch?: typeof fetch
  basePath?: string
  timeoutMs?: number
  retry?: Partial<RetryPolicy> | false
  defaultHeaders?: Record<string, string>
  correlationIdFactory?: () => string
  idempotencyKeyFactory?: () => IdempotencyKey
  userAgent?: string
  credentials?: RequestCredentials
  /** Hard cap for a successful REST response body in bytes. */
  maxResponseBytes?: number
  /** Cap for a stored error response body in bytes. */
  maxErrorBodyBytes?: number
  /** Hard cap for a single SSE event in bytes. */
  maxSseEventBytes?: number
}

export interface ResolvedApiClientOptions {
  baseUrl: string
  basePath: string
  surface: NavinSurface
  auth: AuthContext
  transport: HttpTransport
  timeoutMs: number
  retry: RetryPolicy | undefined
  defaultHeaders: Record<string, string>
  correlationIdFactory: () => string
  idempotencyKeyFactory: () => IdempotencyKey
  userAgent?: string
  credentials?: RequestCredentials
  maxResponseBytes: number
  maxErrorBodyBytes: number
  maxSseEventBytes: number
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_ERROR_BODY_BYTES = 64 * 1024
const DEFAULT_MAX_SSE_EVENT_BYTES = 1024 * 1024

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new ApiConfigurationError('ApiClientOptions.baseUrl must be a non-empty URL')
  }
  if (trimmed.includes('\\')) {
    throw new ApiConfigurationError('ApiClientOptions.baseUrl must not contain backslashes')
  }
  const schemeEnd = trimmed.indexOf('://')
  const authorityEnd = schemeEnd >= 0 ? trimmed.indexOf('/', schemeEnd + 3) : -1
  if (authorityEnd >= 0) {
    assertSafePath(
      trimmed.slice(authorityEnd).split(/[?#]/, 1)[0] ?? '/',
      'ApiClientOptions.baseUrl',
    )
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch (error) {
    throw new ApiConfigurationError('ApiClientOptions.baseUrl must be an absolute http(s) URL', {
      cause: error,
    })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiConfigurationError(
      `ApiClientOptions.baseUrl must use http or https, received "${url.protocol}"`,
    )
  }
  if (url.protocol === 'http:' && !isCanonicalLoopbackAuthority(trimmed, schemeEnd)) {
    throw new ApiConfigurationError(
      'ApiClientOptions.baseUrl must use HTTPS except for literal loopback HTTP',
    )
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new ApiConfigurationError('ApiClientOptions.baseUrl must not embed credentials')
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new ApiConfigurationError('ApiClientOptions.baseUrl must not contain a query or fragment')
  }
  assertSafePath(url.pathname, 'ApiClientOptions.baseUrl')
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${path}`
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim()
  if (trimmed.length === 0 || trimmed === '/') return ''
  assertSafePath(trimmed, 'ApiClientOptions.basePath')
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeading.replace(/\/+$/, '')
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 1) {
    throw new ApiConfigurationError(`${name} must be a positive number`)
  }
  return Math.floor(value)
}

export function resolveOptions(options: ApiClientOptions): ResolvedApiClientOptions {
  const auth = options.auth ?? anonymousAuthContext(options.surface)
  if (auth.surface !== options.surface) {
    throw new ApiConfigurationError(
      `Auth context surface "${auth.surface}" cannot be attached to a "${options.surface}" client`,
    )
  }
  assertNoReservedHeaders(options.defaultHeaders, 'defaultHeaders')

  return {
    baseUrl: normalizeBaseUrl(options.baseUrl),
    basePath: normalizeBasePath(options.basePath ?? API_BASE_PATH),
    surface: options.surface,
    auth,
    transport: options.transport ?? new FetchTransport(options.fetch),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retry: options.retry === false ? undefined : mergeRetryPolicy(options.retry),
    defaultHeaders: { ...(options.defaultHeaders ?? {}) },
    correlationIdFactory: options.correlationIdFactory ?? (() => createCorrelationId()),
    idempotencyKeyFactory: options.idempotencyKeyFactory ?? (() => createIdempotencyKey()),
    userAgent: options.userAgent,
    credentials: options.credentials,
    maxResponseBytes: positiveLimit(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      'maxResponseBytes',
    ),
    maxErrorBodyBytes: positiveLimit(
      options.maxErrorBodyBytes,
      DEFAULT_MAX_ERROR_BODY_BYTES,
      'maxErrorBodyBytes',
    ),
    maxSseEventBytes: positiveLimit(
      options.maxSseEventBytes,
      DEFAULT_MAX_SSE_EVENT_BYTES,
      'maxSseEventBytes',
    ),
  }
}
