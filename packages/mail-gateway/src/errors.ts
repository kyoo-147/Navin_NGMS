import type { NavinError, NavinErrorCode, NavinSurface } from '@navin/contracts'

export const REDACTED = '[redacted]'

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|secret|password|token|credential|api[-_]?key)/i

const DEFAULT_STATUS: Record<NavinErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  RISK_STEP_UP_REQUIRED: 403,
  APPROVAL_REQUIRED: 403,
  IDEMPOTENCY_CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  ACTION_BLOCKED: 409,
  SESSION_EXPIRED: 401,
  BAD_REQUEST: 400,
}

const RETRYABLE_CODES: ReadonlySet<NavinErrorCode> = new Set<NavinErrorCode>([
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
])

export interface GatewayErrorOptions {
  code: NavinErrorCode
  message: string
  retryable?: boolean
  httpStatus?: number
  details?: Record<string, unknown>
  cause?: unknown
}

/**
 * Server-side gateway failure carrying a Navin error code and HTTP status.
 *
 * Details are always sanitized before being surfaced so that upstream
 * credentials can never leak through an error envelope.
 */
export class GatewayError extends Error {
  readonly code: NavinErrorCode
  readonly retryable: boolean
  readonly httpStatus: number
  readonly details: Record<string, unknown>

  constructor(options: GatewayErrorOptions) {
    super(options.message)
    this.name = 'GatewayError'
    this.code = options.code
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(options.code)
    this.httpStatus = options.httpStatus ?? DEFAULT_STATUS[options.code]
    this.details = sanitizeDetails(options.details)
    if (options.cause !== undefined) {
      ;(this as { cause?: unknown }).cause = options.cause
    }
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toNavinError(
    context: {
      surface?: NavinSurface
      requestId?: string
      timestamp?: string
    } = {},
  ): NavinError {
    const error: NavinError = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      timestamp: context.timestamp ?? new Date().toISOString(),
    }
    if (context.surface) error.surface = context.surface
    if (context.requestId) error.requestId = context.requestId
    if (Object.keys(this.details).length > 0) error.details = this.details
    return error
  }
}

/**
 * Recursively redacts sensitive keys and secret-shaped values. Applied to all
 * error details and any diagnostic payload produced by the gateway.
 */
export function sanitizeDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!details) return {}
  return sanitizeValue(details) as Record<string, unknown>
}

function sanitizeValue(value: unknown, keyHint?: string): unknown {
  if (typeof value === 'string') {
    if (keyHint && SENSITIVE_KEY_PATTERN.test(keyHint)) return REDACTED
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, keyHint))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeValue(entry, key)
    }
    return out
  }
  return value
}

interface JmapErrorMapping {
  code: NavinErrorCode
  httpStatus: number
  retryable?: boolean
}

const JMAP_METHOD_ERROR_MAP: Record<string, JmapErrorMapping> = {
  accountNotFound: { code: 'NOT_FOUND', httpStatus: 404 },
  accountReadOnly: { code: 'FORBIDDEN', httpStatus: 403 },
  cannotCalculateChanges: { code: 'PRECONDITION_FAILED', httpStatus: 412 },
  forbidden: { code: 'FORBIDDEN', httpStatus: 403 },
  invalidArguments: { code: 'VALIDATION_FAILED', httpStatus: 400 },
  invalidResultReference: { code: 'VALIDATION_FAILED', httpStatus: 400 },
  notFound: { code: 'NOT_FOUND', httpStatus: 404 },
  notRequest: { code: 'BAD_REQUEST', httpStatus: 400 },
  notSupported: { code: 'ACTION_BLOCKED', httpStatus: 409 },
  overQuota: { code: 'RATE_LIMITED', httpStatus: 429, retryable: true },
  rateLimit: { code: 'RATE_LIMITED', httpStatus: 429, retryable: true },
  requestTooLarge: { code: 'BAD_REQUEST', httpStatus: 400 },
  serverFail: { code: 'INTERNAL_ERROR', httpStatus: 500 },
  serverPartialFail: { code: 'INTERNAL_ERROR', httpStatus: 500 },
  serverUnavailable: { code: 'SERVICE_UNAVAILABLE', httpStatus: 503, retryable: true },
  stateMismatch: { code: 'CONFLICT', httpStatus: 409 },
  tooManyChanges: { code: 'CONFLICT', httpStatus: 409 },
  unknownCapability: { code: 'VALIDATION_FAILED', httpStatus: 400 },
  unknownDataType: { code: 'BAD_REQUEST', httpStatus: 400 },
  unknownMethod: { code: 'BAD_REQUEST', httpStatus: 400 },
}

/**
 * Maps a JMAP method-level error `type` (RFC 8620 §3.6.2) to a Navin error.
 */
export function gatewayErrorFromJmapMethod(
  error: { type: string; description?: string },
  extraDetails: Record<string, unknown> = {},
): GatewayError {
  const mapping = JMAP_METHOD_ERROR_MAP[error.type]
  const message = error.description
    ? `${error.type}: ${error.description}`
    : `JMAP error: ${error.type}`
  return new GatewayError({
    code: mapping?.code ?? 'INTERNAL_ERROR',
    message,
    retryable: mapping?.retryable,
    httpStatus: mapping?.httpStatus,
    details: { jmapErrorType: error.type, ...extraDetails },
  })
}

/**
 * Maps an upstream HTTP status (request-level JMAP problem) to a Navin error.
 */
export function gatewayErrorFromHttpStatus(status: number, detail?: string): GatewayError {
  const code: NavinErrorCode =
    status === 400
      ? 'BAD_REQUEST'
      : status === 401
        ? 'UNAUTHORIZED'
        : status === 403
          ? 'FORBIDDEN'
          : status === 404
            ? 'NOT_FOUND'
            : status === 409
              ? 'CONFLICT'
              : status === 429
                ? 'RATE_LIMITED'
                : status >= 500
                  ? 'SERVICE_UNAVAILABLE'
                  : 'INTERNAL_ERROR'
  return new GatewayError({
    code,
    message: detail ?? `Upstream JMAP request failed with HTTP ${status}`,
    httpStatus: status,
    details: { upstreamStatus: status },
  })
}

export function isGatewayError(value: unknown): value is GatewayError {
  return value instanceof GatewayError
}
