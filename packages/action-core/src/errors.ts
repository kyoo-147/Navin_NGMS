import type { NavinError, NavinErrorCode, NavinSurface } from '@navin/contracts'

export interface ActionCoreErrorOptions {
  retryable?: boolean
  details?: Record<string, unknown>
  cause?: unknown
}

/**
 * Error type used across the action/job/event/evidence ledger.
 * Carries a canonical NavinErrorCode so surfaces can map failures consistently.
 */
export class ActionCoreError extends Error {
  readonly code: NavinErrorCode
  readonly retryable: boolean
  readonly details: Record<string, unknown> | undefined

  constructor(code: NavinErrorCode, message: string, options: ActionCoreErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ActionCoreError'
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

export function isActionCoreError(error: unknown): error is ActionCoreError {
  return error instanceof ActionCoreError
}

export function toNavinError(error: unknown, surface?: NavinSurface): NavinError {
  if (isActionCoreError(error)) {
    return error.toNavinError(surface)
  }
  const message = error instanceof Error ? error.message : 'Unexpected action-core failure'
  return {
    code: 'INTERNAL_ERROR',
    message,
    ...(surface === undefined ? {} : { surface }),
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}
