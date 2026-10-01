import { describe, it, expect, vi } from 'vitest'
import {
  GatewayError,
  gatewayErrorFromHttpStatus,
  gatewayErrorFromJmapMethod,
  sanitizeDetails,
  REDACTED,
} from '../src/index.js'

describe('GatewayError', () => {
  it('carries a Navin code, retryability and HTTP status', () => {
    const error = new GatewayError({ code: 'SERVICE_UNAVAILABLE', message: 'down' })
    const navin = error.toNavinError({
      surface: 'mail',
      requestId: 'req-1',
      timestamp: '2026-10-01T00:00:00.000Z',
    })
    expect(navin).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'down',
      retryable: true,
      surface: 'mail',
      requestId: 'req-1',
      timestamp: '2026-10-01T00:00:00.000Z',
    })
  })

  it('omits empty details from the Navin envelope', () => {
    const navin = new GatewayError({ code: 'NOT_FOUND', message: 'nope' }).toNavinError({
      timestamp: '2026-10-01T00:00:00.000Z',
    })
    expect(navin.details).toBeUndefined()
    expect(navin.retryable).toBe(false)
  })
})

describe('JMAP error mapping', () => {
  it('maps known method error types', () => {
    expect(gatewayErrorFromJmapMethod({ type: 'notFound' }).code).toBe('NOT_FOUND')
    expect(gatewayErrorFromJmapMethod({ type: 'stateMismatch' }).code).toBe('CONFLICT')
    expect(gatewayErrorFromJmapMethod({ type: 'invalidArguments' }).code).toBe('VALIDATION_FAILED')
    expect(gatewayErrorFromJmapMethod({ type: 'accountReadOnly' }).code).toBe('FORBIDDEN')
    expect(gatewayErrorFromJmapMethod({ type: 'notSupported' }).code).toBe('ACTION_BLOCKED')
    expect(gatewayErrorFromJmapMethod({ type: 'serverUnavailable' }).retryable).toBe(true)
    expect(gatewayErrorFromJmapMethod({ type: 'cannotCalculateChanges' }).code).toBe(
      'PRECONDITION_FAILED',
    )
  })

  it('falls back to INTERNAL_ERROR for unknown types', () => {
    const error = gatewayErrorFromJmapMethod({ type: 'somethingNew' })
    expect(error.code).toBe('INTERNAL_ERROR')
    expect(error.details['jmapErrorType']).toBe('somethingNew')
  })

  it('maps request-level HTTP status', () => {
    expect(gatewayErrorFromHttpStatus(401).code).toBe('UNAUTHORIZED')
    expect(gatewayErrorFromHttpStatus(429).retryable).toBe(true)
    expect(gatewayErrorFromHttpStatus(503).code).toBe('SERVICE_UNAVAILABLE')
    expect(gatewayErrorFromHttpStatus(418).code).toBe('INTERNAL_ERROR')
  })
})

describe('credential redaction', () => {
  it('redacts sensitive keys recursively', () => {
    const sanitized = sanitizeDetails({
      authorization: 'Basic secret',
      nested: { password: 'hunter2', token: 'abc' },
      safe: 'visible',
      list: [{ apiKey: 'k' }],
    })
    expect(sanitized['authorization']).toBe(REDACTED)
    expect(sanitized['safe']).toBe('visible')
    expect((sanitized['nested'] as Record<string, unknown>)['password']).toBe(REDACTED)
    expect((sanitized['nested'] as Record<string, unknown>)['token']).toBe(REDACTED)
    expect(((sanitized['list'] as unknown[])[0] as Record<string, unknown>)['apiKey']).toBe(
      REDACTED,
    )
  })

  it('never leaks credentials through a thrown GatewayError', () => {
    const secret = 'Basic dXNlcjpwYXNz'
    const error = new GatewayError({
      code: 'UNAUTHORIZED',
      message: 'nope',
      details: { authorization: secret, headers: { Authorization: secret } },
    })
    expect(JSON.stringify(error.details)).not.toContain(secret)
    expect(JSON.stringify(error.toNavinError())).not.toContain(secret)
  })
})

describe('idempotency', () => {
  it('replays a stored response without re-running the producer', async () => {
    const { runIdempotent, InMemoryIdempotencyStore } = await import('../src/index.js')
    const store = new InMemoryIdempotencyStore()
    const produce = vi.fn(async () => ({ ok: true, count: 1 }))
    const first = await runIdempotent({ store, scope: 's', key: 'k', fingerprint: 'f', produce })
    const second = await runIdempotent({ store, scope: 's', key: 'k', fingerprint: 'f', produce })
    expect(first.replayed).toBe(false)
    expect(second.replayed).toBe(true)
    expect(second.value).toEqual(first.value)
    expect(produce).toHaveBeenCalledTimes(1)
  })

  it('fails closed when a key is reused with a different payload', async () => {
    const { runIdempotent, InMemoryIdempotencyStore } = await import('../src/index.js')
    const store = new InMemoryIdempotencyStore()
    await runIdempotent({ store, scope: 's', key: 'k', fingerprint: 'f1', produce: async () => 1 })
    await expect(
      runIdempotent({ store, scope: 's', key: 'k', fingerprint: 'f2', produce: async () => 2 }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('expires records after their TTL', async () => {
    const { runIdempotent, InMemoryIdempotencyStore } = await import('../src/index.js')
    let clock = 0
    const store = new InMemoryIdempotencyStore({ now: () => clock })
    const produce = vi.fn(async () => 'value')
    await runIdempotent({
      store,
      scope: 's',
      key: 'k',
      fingerprint: 'f',
      ttlMs: 100,
      produce,
      now: () => clock,
    })
    clock = 200
    const second = await runIdempotent({
      store,
      scope: 's',
      key: 'k',
      fingerprint: 'f',
      ttlMs: 100,
      produce,
      now: () => clock,
    })
    expect(second.replayed).toBe(false)
    expect(produce).toHaveBeenCalledTimes(2)
  })
})
