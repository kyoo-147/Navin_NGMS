/**
 * Normalized protocol errors for the IMAP/SMTP compatibility clients.
 *
 * The adapter layer above this package maps `ProtocolError` onto the platform
 * `NavinError` envelope exposed by `@navin/contracts`. To keep this package
 * dependency-free and free of lockfile footprint, the structural error shape is
 * declared locally and is byte-for-byte compatible with the contract envelope.
 */

export type ProtocolName = 'transport' | 'imap' | 'smtp'

export type ProtocolErrorCode =
  | 'CONNECT_FAILED'
  | 'TLS_FAILED'
  | 'TLS_REQUIRED'
  | 'STARTTLS_UNSUPPORTED'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'LIMIT_EXCEEDED'
  | 'PROTOCOL_ERROR'
  | 'UNEXPECTED_RESPONSE'
  | 'CONNECTION_CLOSED'
  | 'CAPABILITY_MISSING'
  | 'AUTH_FAILED'
  | 'AUTH_UNSUPPORTED'
  | 'MESSAGE_REJECTED'
  | 'RECIPIENT_REJECTED'
  | 'SEND_FAILED'

/** Mirror of the `NavinErrorCodeSchema` literal union from `@navin/contracts`. */
export type NormalizedErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'RISK_STEP_UP_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'ACTION_BLOCKED'
  | 'SESSION_EXPIRED'
  | 'BAD_REQUEST'

/** Structurally identical to the platform `NavinError` envelope (minus surface/requestId). */
export interface NormalizedProtocolError {
  code: NormalizedErrorCode
  message: string
  retryable: boolean
  details: Record<string, unknown>
  timestamp: string
}

interface ErrorMapping {
  code: NormalizedErrorCode
  retryable: boolean
}

const ERROR_MAP: Record<ProtocolErrorCode, ErrorMapping> = {
  CONNECT_FAILED: { code: 'SERVICE_UNAVAILABLE', retryable: true },
  TLS_FAILED: { code: 'SERVICE_UNAVAILABLE', retryable: true },
  TLS_REQUIRED: { code: 'PRECONDITION_FAILED', retryable: false },
  STARTTLS_UNSUPPORTED: { code: 'PRECONDITION_FAILED', retryable: false },
  TIMEOUT: { code: 'SERVICE_UNAVAILABLE', retryable: true },
  ABORTED: { code: 'INTERNAL_ERROR', retryable: false },
  LIMIT_EXCEEDED: { code: 'VALIDATION_FAILED', retryable: false },
  PROTOCOL_ERROR: { code: 'INTERNAL_ERROR', retryable: false },
  UNEXPECTED_RESPONSE: { code: 'INTERNAL_ERROR', retryable: false },
  CONNECTION_CLOSED: { code: 'SERVICE_UNAVAILABLE', retryable: true },
  CAPABILITY_MISSING: { code: 'PRECONDITION_FAILED', retryable: false },
  AUTH_FAILED: { code: 'UNAUTHORIZED', retryable: false },
  AUTH_UNSUPPORTED: { code: 'PRECONDITION_FAILED', retryable: false },
  MESSAGE_REJECTED: { code: 'VALIDATION_FAILED', retryable: false },
  RECIPIENT_REJECTED: { code: 'VALIDATION_FAILED', retryable: false },
  SEND_FAILED: { code: 'SERVICE_UNAVAILABLE', retryable: true },
}

export interface ProtocolErrorOptions {
  protocol?: ProtocolName
  retryable?: boolean
  details?: Record<string, unknown>
  cause?: unknown
}

/** A normalized, protocol-aware error raised by the transport, IMAP and SMTP clients. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode
  readonly protocol: ProtocolName
  readonly retryable: boolean
  readonly details: Record<string, unknown>

  constructor(code: ProtocolErrorCode, message: string, options: ProtocolErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ProtocolError'
    this.code = code
    this.protocol = options.protocol ?? 'transport'
    this.details = options.details ?? {}
    this.retryable = options.retryable ?? ERROR_MAP[code].retryable
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /** Maps to a `NavinError`-compatible envelope. */
  toNormalizedError(): NormalizedProtocolError {
    const mapping = ERROR_MAP[this.code]
    return {
      code: mapping.code,
      message: this.message,
      retryable: this.retryable,
      details: {
        protocol: this.protocol,
        protocolCode: this.code,
        ...this.details,
      },
      timestamp: new Date().toISOString(),
    }
  }
}

export function isProtocolError(value: unknown): value is ProtocolError {
  return value instanceof ProtocolError
}

interface NormalizeFallback {
  code: ProtocolErrorCode
  protocol: ProtocolName
  message?: string
}

/**
 * Wraps an arbitrary thrown value into a `ProtocolError`, preserving an existing
 * `ProtocolError` unchanged and translating common Node socket errors.
 */
export function normalizeError(error: unknown, fallback: NormalizeFallback): ProtocolError {
  if (error instanceof ProtocolError) return error

  if (error instanceof Error) {
    const errno = (error as NodeJS.ErrnoException).code
    const details: Record<string, unknown> = { cause: error.name }
    if (errno !== undefined) details.errno = errno
    if (errno === 'ETIMEDOUT' || errno === 'ESOCKETTIMEDOUT') {
      return new ProtocolError('TIMEOUT', error.message, {
        protocol: fallback.protocol,
        details,
        cause: error,
      })
    }
    if (errno === 'ECONNREFUSED' || errno === 'ENOTFOUND' || errno === 'EHOSTUNREACH') {
      return new ProtocolError('CONNECT_FAILED', error.message, {
        protocol: fallback.protocol,
        details,
        cause: error,
      })
    }
    return new ProtocolError(fallback.code, error.message || fallback.message || 'protocol error', {
      protocol: fallback.protocol,
      details,
      cause: error,
    })
  }

  return new ProtocolError(fallback.code, fallback.message ?? 'Unknown protocol error', {
    protocol: fallback.protocol,
    details: { cause: String(error) },
  })
}
