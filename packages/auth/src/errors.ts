export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'INVALID_TOKEN'
  | 'WRONG_AUDIENCE'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_REVOKED'
  | 'TOKEN_EXPIRED'
  | 'ACCOUNT_DISABLED'
  | 'FORBIDDEN'
  | 'INSUFFICIENT_SCOPE'
  | 'STEP_UP_REQUIRED'
  | 'RECENT_AUTH_REQUIRED'
  | 'TYPED_CONFIRMATION_REQUIRED'
  | 'CSRF_FAILED'
  | 'ORIGIN_FORBIDDEN'
  | 'PASSWORD_POLICY'
  | 'EMAIL_IN_USE'
  | 'VALIDATION_FAILED'
  | 'STORE_ERROR'
  | 'NOT_FOUND'

const MESSAGES: Record<AuthErrorCode, string> = {
  INVALID_CREDENTIALS: 'Invalid credentials',
  INVALID_TOKEN: 'Invalid session token',
  WRONG_AUDIENCE: 'Token was not issued for this relying party',
  SESSION_NOT_FOUND: 'Session not found',
  SESSION_REVOKED: 'Session has been revoked',
  TOKEN_EXPIRED: 'Session token has expired',
  ACCOUNT_DISABLED: 'Account is not active',
  FORBIDDEN: 'Operation is not permitted',
  INSUFFICIENT_SCOPE: 'Principal lacks a required scope',
  STEP_UP_REQUIRED: 'Additional authentication is required',
  RECENT_AUTH_REQUIRED: 'Recent authentication is required',
  TYPED_CONFIRMATION_REQUIRED: 'Typed confirmation is required',
  CSRF_FAILED: 'Cross-site request verification failed',
  ORIGIN_FORBIDDEN: 'Request origin is not allowed',
  PASSWORD_POLICY: 'Password does not meet policy',
  EMAIL_IN_USE: 'An account with that email already exists',
  VALIDATION_FAILED: 'Input validation failed',
  STORE_ERROR: 'Auth store operation failed',
  NOT_FOUND: 'Record not found',
}

/**
 * Domain error type. Messages are fixed per code and never interpolate
 * credentials, tokens, hashes or other secrets, so errors are safe to log.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: AuthErrorCode, details?: Record<string, unknown>) {
    super(MESSAGES[code])
    this.name = 'AuthError'
    this.code = code
    this.details = details
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError
}
