export type HttpErrorCode =
  | 'BAD_REQUEST'
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

export interface ErrorEnvelope {
  error: {
    code: HttpErrorCode
    message: string
    retryable: boolean
    correlationId: string
    timestamp: string
    details?: Record<string, unknown>
  }
}

export function statusToErrorCode(statusCode: number): HttpErrorCode {
  switch (statusCode) {
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
    case 422:
      return 'VALIDATION_FAILED'
    case 429:
      return 'RATE_LIMITED'
    case 503:
      return 'SERVICE_UNAVAILABLE'
    default:
      return statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'
  }
}

export interface ErrorEnvelopeInput {
  code: HttpErrorCode
  message: string
  retryable: boolean
  correlationId: string
  timestamp: string
  details?: Record<string, unknown>
}

export function errorEnvelope(input: ErrorEnvelopeInput): ErrorEnvelope {
  const error: ErrorEnvelope['error'] = {
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    correlationId: input.correlationId,
    timestamp: input.timestamp,
  }
  if (input.details) {
    error.details = input.details
  }
  return { error }
}
