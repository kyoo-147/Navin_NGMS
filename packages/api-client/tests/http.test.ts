import { afterEach, describe, expect, it } from 'vitest'
import {
  ApiCancelledError,
  ApiClientError,
  ApiTimeoutError,
  ControlApiClient,
} from '../src/index.js'
import { startHttpFixture, sendJson, type HttpFixture } from './fixtures/http-server.js'
import { healthResponse, navinError } from './fixtures/samples.js'

const fixtures: HttpFixture[] = []

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()
    if (fixture) await fixture.close()
  }
})

async function createFixture(
  handler: Parameters<typeof startHttpFixture>[0],
): Promise<HttpFixture> {
  const fixture = await startHttpFixture(handler)
  fixtures.push(fixture)
  return fixture
}

describe('REST transport', () => {
  it('validates the response and sends surface + correlation headers', async () => {
    const fixture = await createFixture((_request, response) => {
      sendJson(response, 200, healthResponse())
    })
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      correlationIdFactory: () => 'cor_fixed',
      retry: false,
    })

    const health = await client.health()
    expect(health).toEqual({ status: 'ok', version: '0.1.0', uptimeMs: 1234 })

    const record = fixture.requests.at(0)
    expect(record?.method).toBe('GET')
    expect(record?.path).toBe('/api/v1/health')
    expect(record?.headers['x-navin-surface']).toBe('control')
    expect(record?.headers['x-correlation-id']).toBe('cor_fixed')
    expect(record?.headers.accept).toBe('application/json')
  })

  it('rejects a response that violates its contract', async () => {
    const fixture = await createFixture((_request, response) => {
      sendJson(response, 200, { status: 'unexpected', version: '0.1.0', uptimeMs: 1 })
    })
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl, retry: false })
    await expect(client.health()).rejects.toMatchObject({
      code: 'RESPONSE_VALIDATION_FAILED',
    })
  })

  it('validates request payloads before touching the network', async () => {
    const fixture = await createFixture((_request, response) => {
      sendJson(response, 200, {})
    })
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl, retry: false })
    await expect(client.createSetupSession({ title: '' })).rejects.toMatchObject({
      code: 'REQUEST_VALIDATION_FAILED',
    })
    expect(fixture.requests).toHaveLength(0)
  })

  it('surfaces a NavinError body as an explicit error', async () => {
    const fixture = await createFixture((_request, response) => {
      sendJson(response, 404, navinError('NOT_FOUND', 'job missing', { requestId: 'req_1' }))
    })
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl, retry: false })
    const error = await client.getJob('job_x').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({ code: 'NOT_FOUND', requestId: 'req_1', status: 404 })
  })

  it('retries retryable failures up to the bound and then succeeds', async () => {
    let attempts = 0
    const fixture = await createFixture((_request, response) => {
      attempts += 1
      if (attempts < 3) {
        sendJson(response, 503, navinError('SERVICE_UNAVAILABLE', 'starting', { retryable: true }))
        return
      }
      sendJson(response, 200, healthResponse())
    })
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: 'none' },
    })

    await expect(client.health()).resolves.toMatchObject({ status: 'ok' })
    expect(attempts).toBe(3)
    expect(fixture.requests).toHaveLength(3)
  })

  it('does not retry non-retryable client errors', async () => {
    let attempts = 0
    const fixture = await createFixture((_request, response) => {
      attempts += 1
      sendJson(response, 400, navinError('BAD_REQUEST', 'bad input'))
    })
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: 'none' },
    })

    await expect(client.health()).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(attempts).toBe(1)
  })

  it('aborts a slow request with a timeout error', async () => {
    const fixture = await createFixture((_request, response) => {
      setTimeout(() => sendJson(response, 200, healthResponse()), 250)
    })
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      timeoutMs: 30,
      retry: false,
    })

    await expect(client.health()).rejects.toBeInstanceOf(ApiTimeoutError)
  })

  it('cancels an in-flight request through AbortSignal', async () => {
    const fixture = await createFixture((_request, response) => {
      setTimeout(() => sendJson(response, 200, healthResponse()), 250)
    })
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl, retry: false })
    const controller = new AbortController()
    const pending = client.health({ signal: controller.signal })
    setTimeout(() => controller.abort(), 20)

    await expect(pending).rejects.toBeInstanceOf(ApiCancelledError)
  })

  it('captures the echoed response request id on failures', async () => {
    const fixture = await createFixture((_request, response) => {
      response.setHeader('x-request-id', 'srv_req_9')
      sendJson(response, 500, navinError('INTERNAL_ERROR', 'boom'))
    })
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl, retry: false })
    await expect(client.health()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      requestId: 'srv_req_9',
    })
  })
})
