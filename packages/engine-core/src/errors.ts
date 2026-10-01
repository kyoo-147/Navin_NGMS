export type EngineErrorCategory =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'precondition'
  | 'validation'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'cancelled'
  | 'transport'
  | 'protocol'
  | 'internal'

/**
 * Structural mirror of the frozen `NavinErrorCode` union from `@navin/contracts`.
 * `tests/contract-conformance.test.ts` asserts this stays assignable to the
 * contract type without importing it at build time.
 */
export type EngineNavinErrorCode =
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

const NAVIN_CODE_BY_CATEGORY: Record<EngineErrorCategory, EngineNavinErrorCode> = {
  unauthenticated: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  not_found: 'NOT_FOUND',
  conflict: 'CONFLICT',
  precondition: 'PRECONDITION_FAILED',
  validation: 'VALIDATION_FAILED',
  rate_limited: 'RATE_LIMITED',
  unavailable: 'SERVICE_UNAVAILABLE',
  timeout: 'SERVICE_UNAVAILABLE',
  cancelled: 'INTERNAL_ERROR',
  transport: 'SERVICE_UNAVAILABLE',
  protocol: 'INTERNAL_ERROR',
  internal: 'INTERNAL_ERROR',
}

const RETRYABLE_BY_CATEGORY: Record<EngineErrorCategory, boolean> = {
  unauthenticated: false,
  forbidden: false,
  not_found: false,
  conflict: false,
  precondition: false,
  validation: false,
  rate_limited: true,
  unavailable: true,
  timeout: true,
  cancelled: false,
  transport: true,
  protocol: false,
  internal: false,
}

const SECRET_KEY_PATTERN =
  /(pass(word)?|secret|token|authorization|credential|api[_-]?key|private[_-]?key|cookie|set[_-]?cookie)/i

const SECRET_TEXT_PATTERNS = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.~-]+/gi,
  /((?:https?|wss?):\/\/)[^\s/@:]+:[^\s/@]+@/gi,
  /\b(password|passphrase|secret|token|authorization|credential|api[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\s*([=:])\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,
]

function redactText(value: string): string {
  return SECRET_TEXT_PATTERNS.reduce((text, pattern) => {
    if (pattern === SECRET_TEXT_PATTERNS[1]) {
      return text.replace(pattern, '$1[REDACTED]@[REDACTED]')
    }
    return text.replace(pattern, (_match, keyOrScheme: string, separator?: string) => {
      if (separator === undefined) return `${keyOrScheme} [REDACTED]`
      return `${keyOrScheme}${separator}[REDACTED]`
    })
  }, value)
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, seen))

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? '[REDACTED]' : redactValue(entry, seen)
  }
  return out
}

export interface NavinErrorShape {
  code: EngineNavinErrorCode
  message: string
  surface?: 'mail' | 'control' | 'cli'
  retryable: boolean
  details?: Record<string, unknown>
  requestId?: string
  timestamp: string
}

export interface EngineErrorInit {
  category: EngineErrorCategory
  message: string
  retryable?: boolean
  status?: number
  requestId?: string
  details?: Record<string, unknown>
  cause?: unknown
}

export class EngineError extends Error {
  readonly category: EngineErrorCategory
  readonly navinCode: EngineNavinErrorCode
  readonly retryable: boolean
  readonly status?: number
  readonly requestId?: string
  readonly details: Record<string, unknown>

  constructor(init: EngineErrorInit) {
    super(redactText(init.message), init.cause === undefined ? undefined : { cause: '[REDACTED]' })
    this.name = 'EngineError'
    this.category = init.category
    this.navinCode = NAVIN_CODE_BY_CATEGORY[init.category]
    this.retryable = init.retryable ?? RETRYABLE_BY_CATEGORY[init.category]
    this.status = init.status
    this.requestId = init.requestId
    this.details = redactSecrets(init.details ?? {})
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isEngineError(value: unknown): value is EngineError {
  return value instanceof EngineError
}

/**
 * Recursively replaces values held under secret-looking keys so credentials,
 * bearer tokens and passwords never reach logs, events or error envelopes.
 */
export function redactSecrets(value: unknown, _depth = 0): Record<string, unknown> {
  void _depth
  if (value === null || typeof value !== 'object') return {}
  return redactValue(value, new WeakSet<object>()) as Record<string, unknown>
}

function firstString(source: unknown, keys: string[]): string | undefined {
  if (source === null || typeof source !== 'object') return undefined
  const record = source as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

export interface NormalizeContext {
  requestId?: string
  timedOut?: boolean
  status?: number
}

export function normalizeEngineError(error: unknown, context: NormalizeContext = {}): EngineError {
  if (error instanceof EngineError) {
    if (context.requestId && !error.requestId) {
      return new EngineError({
        category: error.category,
        message: error.message,
        retryable: error.retryable,
        status: error.status,
        requestId: context.requestId,
        details: error.details,
        cause: error,
      })
    }
    return error
  }

  if (isAbortLikeError(error)) {
    return new EngineError({
      category: context.timedOut ? 'timeout' : 'cancelled',
      message: context.timedOut ? 'Engine request timed out' : 'Engine request was cancelled',
      requestId: context.requestId,
      cause: error,
    })
  }

  if (error instanceof TypeError) {
    return new EngineError({
      category: 'transport',
      message: `Engine transport failure: ${error.message}`,
      requestId: context.requestId,
      cause: error,
    })
  }

  const message = error instanceof Error ? error.message : String(error)
  return new EngineError({
    category: 'internal',
    message: message.length > 0 ? message : 'Unknown engine error',
    details: { reason: message },
    requestId: context.requestId,
    cause: error,
  })
}

export function isAbortLikeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = (error as { name?: unknown }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

export function toNavinError(
  error: unknown,
  options: { surface?: 'mail' | 'control' | 'cli'; requestId?: string } = {},
): NavinErrorShape {
  const engineError = normalizeEngineError(error, { requestId: options.requestId })
  const shape: NavinErrorShape = {
    code: engineError.navinCode,
    message: engineError.message,
    retryable: engineError.retryable,
    timestamp: new Date().toISOString(),
  }
  if (options.surface) shape.surface = options.surface
  if (engineError.requestId) shape.requestId = engineError.requestId
  if (Object.keys(engineError.details).length > 0) shape.details = engineError.details
  return shape
}

export function describeEngineError(error: EngineError): string {
  const status = error.status === undefined ? '' : ` status=${error.status}`
  return `[${error.category}:${error.navinCode}${status}] ${error.message}`
}

export function extractErrorMessage(body: unknown, fallback: string): string {
  const message = firstString(body, [
    'detail',
    'message',
    'error',
    'error_description',
    'description',
  ])
  return message ?? fallback
}
