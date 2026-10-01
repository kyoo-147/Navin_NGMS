import { describe, it, expect } from 'vitest'
import {
  EngineError,
  extractErrorMessage,
  normalizeEngineError,
  redactSecrets,
  toNavinError,
} from '../src/index.js'

describe('engine error normalization', () => {
  it('classifies aborts as cancelled and timeouts as timeout', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'

    expect(normalizeEngineError(abort).category).toBe('cancelled')
    expect(normalizeEngineError(abort, { timedOut: true }).category).toBe('timeout')
  })

  it('classifies network failures as transport and preserves existing EngineErrors', () => {
    expect(normalizeEngineError(new TypeError('fetch failed')).category).toBe('transport')

    const original = new EngineError({ category: 'conflict', message: 'duplicate' })
    expect(normalizeEngineError(original)).toBe(original)
  })

  it('enriches an EngineError with a request id without changing its category', () => {
    const enriched = normalizeEngineError(
      new EngineError({ category: 'not_found', message: 'gone' }),
      {
        requestId: 'req-9',
      },
    )

    expect(enriched.requestId).toBe('req-9')
    expect(enriched.navinCode).toBe('NOT_FOUND')
  })

  it('applies default retryability per category', () => {
    expect(new EngineError({ category: 'unavailable', message: 'x' }).retryable).toBe(true)
    expect(new EngineError({ category: 'validation', message: 'x' }).retryable).toBe(false)
    expect(new EngineError({ category: 'rate_limited', message: 'x' }).retryable).toBe(true)
  })

  it('redacts arrays, deep values, circular values, and secret-bearing text', () => {
    const circular: Record<string, unknown> = { password: 'do-not-leak' }
    circular.self = circular
    const redacted = redactSecrets({
      values: [{ token: 'abc' }, { keep: 'visible' }],
      message: 'Bearer abc password=hunter2',
      circular,
    })
    expect(JSON.stringify(redacted)).not.toContain('do-not-leak')
    expect(JSON.stringify(redacted)).not.toContain('hunter2')
    expect(JSON.stringify(redacted)).not.toContain('Bearer abc')
    expect((redacted.values as Array<Record<string, unknown>>)[0]?.token).toBe('[REDACTED]')
    expect((redacted.circular as Record<string, unknown>).self).toBe('[CIRCULAR]')
  })

  it('redacts secret-bearing keys recursively', () => {
    const redacted = redactSecrets({
      user: 'alice',
      password: 'hunter2',
      nested: { token: 'abc', authorization: 'Bearer abc', keep: 'visible' },
    })

    expect(redacted.user).toBe('alice')
    expect(redacted.password).toBe('[REDACTED]')
    const nested = redacted.nested as Record<string, unknown>
    expect(nested.token).toBe('[REDACTED]')
    expect(nested.authorization).toBe('[REDACTED]')
    expect(nested.keep).toBe('visible')
  })

  it('builds a serializable NavinError envelope and extracts messages', () => {
    const envelope = toNavinError(new EngineError({ category: 'forbidden', message: 'nope' }), {
      surface: 'cli',
    })

    expect(envelope).toMatchObject({ code: 'FORBIDDEN', retryable: false, surface: 'cli' })
    expect(typeof envelope.timestamp).toBe('string')
    expect(extractErrorMessage({ detail: 'detailed failure' }, 'fallback')).toBe('detailed failure')
    expect(extractErrorMessage('nope', 'fallback')).toBe('fallback')
  })
})
