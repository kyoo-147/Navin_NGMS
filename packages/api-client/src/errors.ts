import {
  NavinErrorSchema,
  validate,
  type NavinError,
  type NavinErrorCode,
  type NavinSurface,
  type ValidationErrorItem,
} from '@navin/contracts'

export type ApiClientErrorCode =
  | NavinErrorCode
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'REQUEST_VALIDATION_FAILED'
  | 'RESPONSE_VALIDATION_FAILED'
  | 'SSE_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'RESPONSE_TOO_LARGE'

export interface ApiErrorContext {
  surface?: NavinSurface
  correlationId?: string
  requestId?: string
  details?: Record<string, unknown>
  cause?: unknown
}

export interface ApiClientErrorInit extends ApiErrorContext {
  code: ApiClientErrorCode
  message: string
  retryable?: boolean
  status?: number
  responseBody?: string
  validationErrors?: ValidationErrorItem[]
}

export class ApiClientError extends Error {
  readonly code: ApiClientErrorCode
  readonly retryable: boolean
  readonly status?: number
  readonly surface?: NavinSurface
  readonly correlationId?: string
  readonly requestId?: string
  readonly details?: Record<string, unknown>
  readonly responseBody?: string
  readonly validationErrors?: ValidationErrorItem[]

  constructor(init: ApiClientErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'ApiClientError'
    this.code = init.code
    this.retryable = init.retryable ?? false
    this.status = init.status
    this.surface = init.surface
    this.correlationId = init.correlationId
    this.requestId = init.requestId
    this.details = init.details
    this.responseBody = init.responseBody
    this.validationErrors = init.validationErrors
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      status: this.status,
      surface: this.surface,
      correlationId: this.correlationId,
      requestId: this.requestId,
      details: this.details,
    }
  }
}

export interface ApiHttpErrorContext extends ApiErrorContext {
  retryable?: boolean
  responseBody?: string
  code?: ApiClientErrorCode
}

export class ApiHttpError extends ApiClientError {
  constructor(status: number, message: string, context: ApiHttpErrorContext = {}) {
    super({ code: 'HTTP_ERROR', message, status, ...context })
    this.name = 'ApiHttpError'
  }
}

export class ApiNetworkError extends ApiClientError {
  constructor(message = 'Network request failed', context: ApiErrorContext = {}) {
    super({ code: 'NETWORK_ERROR', message, retryable: true, ...context })
    this.name = 'ApiNetworkError'
  }
}

export class ApiTimeoutError extends ApiClientError {
  constructor(message = 'Request timed out', context: ApiErrorContext = {}) {
    super({ code: 'TIMEOUT', message, retryable: true, ...context })
    this.name = 'ApiTimeoutError'
  }
}

export class ApiCancelledError extends ApiClientError {
  constructor(message = 'Operation was cancelled', context: ApiErrorContext = {}) {
    super({ code: 'CANCELLED', message, retryable: false, ...context })
    this.name = 'ApiCancelledError'
  }
}

export class ApiValidationError extends ApiClientError {
  constructor(
    code: 'REQUEST_VALIDATION_FAILED' | 'RESPONSE_VALIDATION_FAILED',
    message: string,
    validationErrors: ValidationErrorItem[],
    context: ApiErrorContext = {},
  ) {
    super({ code, message, retryable: false, validationErrors, ...context })
    this.name = 'ApiValidationError'
  }
}

export class ApiSseError extends ApiClientError {
  constructor(message: string, context: ApiErrorContext = {}) {
    super({ code: 'SSE_ERROR', message, retryable: true, ...context })
    this.name = 'ApiSseError'
  }
}

/** Raised for invalid client configuration (surface mismatch, bad baseUrl, reserved headers). */
export class ApiConfigurationError extends ApiClientError {
  constructor(message: string, context: ApiErrorContext = {}) {
    super({ code: 'CONFIGURATION_ERROR', message, retryable: false, ...context })
    this.name = 'ApiConfigurationError'
  }
}

/** Raised when a response/event body exceeds the configured bound. */
export class ApiResponseTooLargeError extends ApiClientError {
  readonly limitBytes?: number

  constructor(message: string, context: ApiErrorContext & { limitBytes?: number } = {}) {
    super({
      code: 'RESPONSE_TOO_LARGE',
      message,
      retryable: false,
      surface: context.surface,
      correlationId: context.correlationId,
      requestId: context.requestId,
      details: { ...(context.details ?? {}), limitBytes: context.limitBytes },
      cause: context.cause,
    })
    this.name = 'ApiResponseTooLargeError'
    this.limitBytes = context.limitBytes
  }
}

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError
}

export function isAbortError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

function mapStatusToCode(status: number): ApiClientErrorCode {
  switch (status) {
    case 400:
      return 'BAD_REQUEST'
    case 401:
      return 'UNAUTHORIZED'
    case 403:
      return 'FORBIDDEN'
    case 404:
      return 'NOT_FOUND'
    case 409:
      return 'CONFLICT'
    case 412:
      return 'PRECONDITION_FAILED'
    case 422:
      return 'VALIDATION_FAILED'
    case 423:
    case 428:
      return 'RISK_STEP_UP_REQUIRED'
    case 429:
      return 'RATE_LIMITED'
    case 500:
      return 'INTERNAL_ERROR'
    case 502:
    case 503:
    case 504:
      return 'SERVICE_UNAVAILABLE'
    default:
      return 'HTTP_ERROR'
  }
}

function parseNavinError(body: string): NavinError | undefined {
  if (body.length === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  const result = validate(NavinErrorSchema, parsed)
  return result.success ? result.data : undefined
}

export function mapHttpError(
  status: number,
  responseBody: string,
  context: ApiErrorContext = {},
): ApiHttpError {
  const navinError = parseNavinError(responseBody)
  if (navinError) {
    return new ApiHttpError(status, navinError.message, {
      surface: navinError.surface ?? context.surface,
      correlationId: context.correlationId,
      requestId: navinError.requestId ?? context.requestId,
      details: navinError.details,
      code: navinError.code,
      retryable: navinError.retryable,
      responseBody,
    })
  }
  const code = mapStatusToCode(status)
  const retryable = status === 429 || status >= 500
  return new ApiHttpError(status, `Request failed with status ${status}`, {
    ...context,
    code,
    retryable,
    responseBody,
  })
}

export function toApiClientError(
  error: unknown,
  context: ApiErrorContext & { timedOut?: boolean; signal?: AbortSignal; timeoutMs?: number },
): ApiClientError {
  if (isApiClientError(error)) return error
  if (context.timedOut) {
    return new ApiTimeoutError('Request timed out', {
      surface: context.surface,
      correlationId: context.correlationId,
      requestId: context.requestId,
      cause: error,
    })
  }
  if (context.signal?.aborted) {
    return new ApiCancelledError('Operation was cancelled', {
      surface: context.surface,
      correlationId: context.correlationId,
      requestId: context.requestId,
      cause: error,
    })
  }
  if (isAbortError(error)) {
    return new ApiCancelledError('Operation was cancelled', {
      surface: context.surface,
      correlationId: context.correlationId,
      requestId: context.requestId,
      cause: error,
    })
  }
  const message = error instanceof Error ? error.message : 'Network request failed'
  return new ApiNetworkError(message, {
    surface: context.surface,
    correlationId: context.correlationId,
    requestId: context.requestId,
    cause: error,
  })
}
