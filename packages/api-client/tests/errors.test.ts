import { describe, expect, it } from 'vitest'
import {
  ApiCancelledError,
  ApiClientError,
  ApiNetworkError,
  ApiTimeoutError,
  isApiClientError,
  mapHttpError,
  toApiClientError,
} from '../src/errors.js'
import { navinError } from './fixtures/samples.js'

describe('error mapping', () => {
  it('preserves a NavinError envelope from the response body', () => {
    const body = JSON.stringify(
      navinError('PRECONDITION_FAILED', 'Fingerprint mismatch', { requestId: 'req_42' }),
    )
    const error = mapHttpError(412, body, { correlationId: 'cor_1', surface: 'control' })
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error.code).toBe('PRECONDITION_FAILED')
    expect(error.retryable).toBe(false)
    expect(error.requestId).toBe('req_42')
    expect(error.correlationId).toBe('cor_1')
    expect(error.surface).toBe('control')
    expect(error.status).toBe(412)
  })

  it('maps bare status codes when the body is not a NavinError', () => {
    expect(mapHttpError(404, '', {}).code).toBe('NOT_FOUND')
    expect(mapHttpError(401, 'nope', {}).code).toBe('UNAUTHORIZED')
    const unavailable = mapHttpError(503, '<html>', {})
    expect(unavailable.code).toBe('SERVICE_UNAVAILABLE')
    expect(unavailable.retryable).toBe(true)
    expect(mapHttpError(429, '', {}).retryable).toBe(true)
  })

  it('classifies timeout, cancellation and network failures', () => {
    const timedOut = toApiClientError(new Error('aborted'), { timedOut: true })
    expect(timedOut).toBeInstanceOf(ApiTimeoutError)
    expect(timedOut.code).toBe('TIMEOUT')
    expect(timedOut.retryable).toBe(true)

    const controller = new AbortController()
    controller.abort()
    const cancelled = toApiClientError(new Error('aborted'), { signal: controller.signal })
    expect(cancelled).toBeInstanceOf(ApiCancelledError)
    expect(cancelled.code).toBe('CANCELLED')

    const network = toApiClientError(new Error('connect ECONNREFUSED'), {})
    expect(network).toBeInstanceOf(ApiNetworkError)
    expect(network.code).toBe('NETWORK_ERROR')
    expect(network.retryable).toBe(true)
  })

  it('passes existing ApiClientError instances through unchanged', () => {
    const original = new ApiTimeoutError('already mapped')
    expect(toApiClientError(original, {})).toBe(original)
    expect(isApiClientError(original)).toBe(true)
    expect(isApiClientError(new Error('plain'))).toBe(false)
  })
})
