import type { NavinError, NavinErrorCode, NavinSurface } from '@navin/contracts'
import { EngineError, isEngineError } from '@navin/engine-core'

export interface OrganizationErrorOptions {
  retryable?: boolean
  details?: Record<string, unknown>
  cause?: unknown
}

/**
 * Error type used by organization actions. It carries a canonical
 * `NavinErrorCode` so the HTTP boundary can map a failure to a stable status
 * and envelope without leaking engine internals.
 */
export class OrganizationError extends Error {
  readonly code: NavinErrorCode
  readonly retryable: boolean
  readonly details: Record<string, unknown> | undefined

  constructor(code: NavinErrorCode, message: string, options: OrganizationErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'OrganizationError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.details = options.details
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toNavinError(surface?: NavinSurface): NavinError {
    return {
      code: this.code,
      message: this.message,
      ...(surface === undefined ? {} : { surface }),
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: this.details }),
      timestamp: new Date().toISOString(),
    }
  }
}

export function isOrganizationError(value: unknown): value is OrganizationError {
  return value instanceof OrganizationError
}

/**
 * Normalizes an adapter failure into an `OrganizationError` without inventing a
 * success: an engine transport/timeout/unavailable failure stays retryable, a
 * validation/precondition failure stays terminal.
 */
export function toOrganizationError(
  error: unknown,
  fallback: { code?: NavinErrorCode; message?: string; needsAttention?: boolean } = {},
): OrganizationError {
  if (isOrganizationError(error)) {
    return error
  }
  if (isEngineError(error) || error instanceof EngineError) {
    const engineError = error as EngineError
    return new OrganizationError(engineError.navinCode, engineError.message, {
      retryable: engineError.retryable,
      details: {
        ...engineError.details,
        ...(fallback.needsAttention === true ? { needsAttention: true } : {}),
        engineCategory: engineError.category,
      },
      cause: error,
    })
  }
  const message = error instanceof Error ? error.message : 'Unexpected organization action failure'
  return new OrganizationError(fallback.code ?? 'INTERNAL_ERROR', fallback.message ?? message, {
    retryable: false,
    ...(fallback.needsAttention === true ? { details: { needsAttention: true } } : {}),
    cause: error,
  })
}
