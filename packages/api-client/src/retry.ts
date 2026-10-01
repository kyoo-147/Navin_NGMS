import { ApiCancelledError, type ApiClientError, type ApiClientErrorCode } from './errors.js'

export type BackoffJitter = 'none' | 'full'

export interface RetryPolicy {
  /** Total attempts including the first one. Must be >= 1. */
  maxAttempts: number
  baseDelayMs: number
  factor: number
  maxDelayMs: number
  jitter: BackoffJitter
  /** When false, unsafe methods without an idempotency key are never retried. */
  retryUnsafeMethods: boolean
  retryableCodes: readonly ApiClientErrorCode[]
  /** Upper bound applied to a server `Retry-After` hint. */
  maxRetryAfterMs: number
  random: () => number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  factor: 2,
  maxDelayMs: 4_000,
  jitter: 'full',
  retryUnsafeMethods: false,
  retryableCodes: [
    'RATE_LIMITED',
    'SERVICE_UNAVAILABLE',
    'INTERNAL_ERROR',
    'NETWORK_ERROR',
    'TIMEOUT',
  ],
  maxRetryAfterMs: 30_000,
  random: Math.random,
}

export function mergeRetryPolicy(partial?: Partial<RetryPolicy>): RetryPolicy {
  if (!partial) return { ...DEFAULT_RETRY_POLICY }
  const merged: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...partial }
  if (!Number.isInteger(merged.maxAttempts) || merged.maxAttempts < 1) {
    throw new Error('Retry policy maxAttempts must be a positive integer')
  }
  if (!Number.isFinite(merged.baseDelayMs) || merged.baseDelayMs < 0) {
    throw new Error('Retry policy baseDelayMs must be a finite non-negative number')
  }
  if (!Number.isFinite(merged.factor) || merged.factor < 1) {
    throw new Error('Retry policy factor must be a finite number at least 1')
  }
  if (!Number.isFinite(merged.maxDelayMs) || merged.maxDelayMs < 0) {
    throw new Error('Retry policy maxDelayMs must be a finite non-negative number')
  }
  if (merged.jitter !== 'none' && merged.jitter !== 'full') {
    throw new Error('Retry policy jitter must be "none" or "full"')
  }
  if (!Number.isFinite(merged.maxRetryAfterMs) || merged.maxRetryAfterMs < 0) {
    throw new Error('Retry policy maxRetryAfterMs must be a finite non-negative number')
  }
  if (typeof merged.random !== 'function') {
    throw new Error('Retry policy random must be a function')
  }
  return merged
}

/** Resolves a per-call retry setting against the client default. `false` disables retries. */
export function resolveRetryPolicy(
  setting: Partial<RetryPolicy> | false | undefined,
  fallback?: RetryPolicy,
): RetryPolicy | undefined {
  if (setting === false) return undefined
  if (setting === undefined) return fallback
  return mergeRetryPolicy(setting)
}

export function isSafeMethod(method: string): boolean {
  const upper = method.toUpperCase()
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS'
}

export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - Date.now())
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function computeBackoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined) {
    return clamp(retryAfterMs, 0, policy.maxRetryAfterMs)
  }
  const exponential = policy.baseDelayMs * policy.factor ** Math.max(0, attempt - 1)
  const capped = Math.min(policy.maxDelayMs, exponential)
  if (policy.jitter === 'full') {
    return Math.floor(clamp(policy.random(), 0, 1) * capped)
  }
  return Math.floor(capped)
}

/**
 * Decides whether an error may be retried for a given request. Unsafe methods are only retried
 * when an idempotency key makes the retry safe.
 */
export function shouldRetry(
  error: ApiClientError,
  policy: RetryPolicy,
  method: string,
  hasIdempotencyKey: boolean,
): boolean {
  if (error.code === 'CANCELLED') return false
  if (
    error.code === 'REQUEST_VALIDATION_FAILED' ||
    error.code === 'RESPONSE_VALIDATION_FAILED' ||
    error.code === 'SSE_ERROR'
  ) {
    return false
  }
  if (!policy.retryableCodes.includes(error.code)) return false
  if (isSafeMethod(method)) return true
  if (hasIdempotencyKey) return true
  return policy.retryUnsafeMethods
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new ApiCancelledError('Operation was cancelled', { cause: signal?.reason }))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new ApiCancelledError('Operation was cancelled', { cause: signal.reason }))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}
