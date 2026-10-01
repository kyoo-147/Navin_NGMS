import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RETRY_POLICY,
  computeBackoffDelayMs,
  isSafeMethod,
  mergeRetryPolicy,
  parseRetryAfter,
  resolveRetryPolicy,
  shouldRetry,
  type RetryPolicy,
} from '../src/retry.js'
import { ApiCancelledError, ApiTimeoutError, ApiValidationError } from '../src/errors.js'

function policy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return { ...DEFAULT_RETRY_POLICY, jitter: 'none', random: () => 0, ...overrides }
}

describe('retry policy', () => {
  it('computes exponential backoff bounded by maxDelayMs', () => {
    const configured = policy({ baseDelayMs: 100, factor: 2, maxDelayMs: 500 })
    expect(computeBackoffDelayMs(1, configured)).toBe(100)
    expect(computeBackoffDelayMs(2, configured)).toBe(200)
    expect(computeBackoffDelayMs(3, configured)).toBe(400)
    expect(computeBackoffDelayMs(4, configured)).toBe(500)
    expect(computeBackoffDelayMs(9, configured)).toBe(500)
  })

  it('applies full jitter within the bounded window', () => {
    const configured = policy({
      baseDelayMs: 100,
      factor: 2,
      maxDelayMs: 1_000,
      jitter: 'full',
      random: () => 0.5,
    })
    expect(computeBackoffDelayMs(1, configured)).toBe(50)
    expect(computeBackoffDelayMs(3, configured)).toBe(200)
  })

  it('honours Retry-After but clamps it to maxRetryAfterMs', () => {
    const configured = policy({ maxRetryAfterMs: 400 })
    expect(computeBackoffDelayMs(1, configured, 150)).toBe(150)
    expect(computeBackoffDelayMs(1, configured, 10_000)).toBe(400)
  })

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('2')).toBe(2_000)
    expect(parseRetryAfter('   ')).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('not-a-date')).toBeUndefined()
    const future = new Date(Date.now() + 5_000).toUTCString()
    const parsed = parseRetryAfter(future)
    expect(parsed).toBeGreaterThan(0)
    expect(parsed).toBeLessThanOrEqual(5_000)
  })

  it('retries safe methods but gates unsafe methods on idempotency keys', () => {
    const configured = policy()
    expect(isSafeMethod('GET')).toBe(true)
    expect(isSafeMethod('post')).toBe(false)
    const validationFailure = new ApiValidationError('RESPONSE_VALIDATION_FAILED', 'no', [])
    // Validation failures are never retried regardless of method.
    expect(shouldRetry(validationFailure, configured, 'GET', false)).toBe(false)
    const timeout = new ApiTimeoutError()
    expect(shouldRetry(timeout, configured, 'GET', false)).toBe(true)
    expect(shouldRetry(timeout, configured, 'POST', false)).toBe(false)
    expect(shouldRetry(timeout, configured, 'POST', true)).toBe(true)
    const cancelled = new ApiCancelledError()
    expect(shouldRetry(cancelled, configured, 'GET', false)).toBe(false)
  })

  it('resolves per-call settings and disables retries with false', () => {
    const fallback = mergeRetryPolicy({ maxAttempts: 5 })
    expect(resolveRetryPolicy(undefined, fallback)).toBe(fallback)
    expect(resolveRetryPolicy(false, fallback)).toBeUndefined()
    expect(resolveRetryPolicy({ maxAttempts: 2 }, fallback)?.maxAttempts).toBe(2)
  })

  it('rejects an invalid maxAttempts', () => {
    expect(() => mergeRetryPolicy({ maxAttempts: 0 })).toThrow()
  })
})
