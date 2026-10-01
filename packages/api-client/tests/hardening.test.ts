import { afterEach, describe, expect, it } from 'vitest'
import {
  ApiClientError,
  ApiConfigurationError,
  ApiSseError,
  ControlApiClient,
  MailApiClient,
  bearerAuthContext,
  cookieAuthContext,
  createSseParser,
  staticHeaderAuthContext,
  utf8ByteLength,
} from '../src/index.js'
import {
  openSse,
  sendJson,
  singleHeader,
  startHttpFixture,
  writeSseEvent,
  type HttpFixture,
} from './fixtures/http-server.js'
import { backgroundEvent, healthResponse, navinError } from './fixtures/samples.js'

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

const FAST_RETRY = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: 'none' as const }
const SINGLE_RETRY = { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1, jitter: 'none' as const }

describe('surface binding', () => {
  it('rejects an auth context bound to a different surface', () => {
    expect(
      () =>
        new MailApiClient({
          baseUrl: 'https://mail.example.com',
          auth: bearerAuthContext({ surface: 'control', token: 'x' }),
        }),
    ).toThrow(ApiConfigurationError)
    expect(
      () =>
        new ControlApiClient({
          baseUrl: 'https://admin.example.com',
          auth: cookieAuthContext({ surface: 'mail' }),
        }),
    ).toThrow(ApiConfigurationError)
  })
})

describe('reserved header protection', () => {
  it('rejects reserved headers in defaultHeaders at construction', () => {
    expect(
      () =>
        new ControlApiClient({
          baseUrl: 'https://admin.example.com',
          defaultHeaders: { Authorization: 'Bearer evil' },
        }),
    ).toThrow(ApiConfigurationError)
    expect(
      () =>
        new MailApiClient({
          baseUrl: 'https://mail.example.com',
          defaultHeaders: { 'X-Correlation-Id': 'evil' },
        }),
    ).toThrow(ApiConfigurationError)
  })

  it('rejects reserved headers per call without sending a request', async () => {
    const fixture = await createFixture((_request, response) => {
      sendJson(response, 200, healthResponse())
    })
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl, retry: false })
    await expect(client.health({ headers: { 'Idempotency-Key': 'evil' } })).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    })
    await expect(
      client.health({ headers: { 'Content-Type': 'text/plain' } }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' })
    expect(fixture.requests).toHaveLength(0)
  })

  it('rejects reserved headers from an auth context except authorization/cookie', async () => {
    const fixture = await createFixture((_request, response) => {
      sendJson(response, 200, healthResponse())
    })
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      auth: staticHeaderAuthContext({ surface: 'control', headers: { 'X-Navin-Surface': 'mail' } }),
      retry: false,
    })
    await expect(client.health()).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' })
    expect(fixture.requests).toHaveLength(0)
  })

  it('allows an auth context to set cookie/authorization headers', async () => {
    const fixture = await createFixture((_request, response) => {
      sendJson(response, 200, healthResponse())
    })
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      auth: staticHeaderAuthContext({
        surface: 'control',
        headers: { Cookie: 'session=abc', Authorization: 'Bearer from-auth' },
      }),
      retry: false,
    })
    await client.health()
    const record = fixture.requests.at(0)
    expect(record?.headers.cookie).toBe('session=abc')
    expect(record?.headers.authorization).toBe('Bearer from-auth')
  })

  it('keeps client-owned headers intact for non-reserved custom headers', async () => {
    const fixture = await createFixture((_request, response) => {
      sendJson(response, 200, healthResponse())
    })
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      defaultHeaders: { 'x-trace': 'trace-1' },
      correlationIdFactory: () => 'cor_fixed',
      retry: false,
    })
    await client.health()
    const record = fixture.requests.at(0)
    expect(record?.headers['x-trace']).toBe('trace-1')
    expect(record?.headers['x-navin-surface']).toBe('control')
    expect(record?.headers['x-correlation-id']).toBe('cor_fixed')
  })
})

describe('strict baseUrl', () => {
  it('rejects non-http(s), credentialed, and query/fragment URLs', () => {
    const badUrls = [
      'ftp://example.com',
      'http://example.com',
      'http://localhost',
      'http://127.1',
      'http://2130706433',
      'http://0x7f000001',
      'http://017700000001',
      'https://user:pass@example.com',
      'https://example.com/?a=1',
      'https://example.com/#frag',
      'https://example.com/../secret',
      'https://example.com/%252e%252e/secret',
      'example.com',
    ]
    for (const baseUrl of badUrls) {
      expect(() => new ControlApiClient({ baseUrl })).toThrow(ApiConfigurationError)
    }
    expect(() => new ControlApiClient({ baseUrl: 'http://[::1]' })).not.toThrow()
  })

  it('normalizes a trailing slash and preserves a path prefix', async () => {
    const fixture = await createFixture((_request, response) => {
      sendJson(response, 200, healthResponse())
    })
    const client = new ControlApiClient({ baseUrl: `${fixture.baseUrl}/`, retry: false })
    await client.health()
    expect(fixture.requests.at(0)?.url).toBe('/api/v1/health')
  })

  it('rejects traversal encoded in a route parameter before network access', async () => {
    const client = new ControlApiClient({ baseUrl: 'https://admin.example.com', retry: false })
    await expect(client.getJob('../secret')).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    })
  })
})

describe('fresh auth on retry and reconnect', () => {
  it('resolves a new token on every REST retry', async () => {
    let attempts = 0
    const fixture = await createFixture((_request, response) => {
      attempts += 1
      if (attempts < 3) {
        sendJson(response, 503, navinError('SERVICE_UNAVAILABLE', 'retry', { retryable: true }))
        return
      }
      sendJson(response, 200, healthResponse())
    })
    let tokenCall = 0
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      auth: bearerAuthContext({
        surface: 'control',
        token: () => {
          tokenCall += 1
          return `tok-${tokenCall}`
        },
      }),
      retry: FAST_RETRY,
    })
    await client.health()
    expect(fixture.requests.map((request) => request.headers.authorization)).toEqual([
      'Bearer tok-1',
      'Bearer tok-2',
      'Bearer tok-3',
    ])
  })

  it('resolves a new token on every SSE reconnect', async () => {
    let connections = 0
    const fixture = await createFixture((request, response) => {
      if (request.path !== '/api/v1/events') {
        sendJson(response, 404, navinError('NOT_FOUND', 'no route'))
        return
      }
      connections += 1
      openSse(response)
      if (connections <= 2) {
        const start = Number(singleHeader(request.headers['last-event-id']) ?? '0')
        const id = String(start + 1)
        writeSseEvent(response, {
          id,
          event: 'job.progress',
          data: JSON.stringify(backgroundEvent(`evt_${id}`)),
        })
      }
      response.end()
    })
    let tokenCall = 0
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      auth: bearerAuthContext({
        surface: 'control',
        token: () => {
          tokenCall += 1
          return `tok-${tokenCall}`
        },
      }),
    })
    const subscription = client.events({ retry: FAST_RETRY })
    await subscription.done
    const auths = fixture
      .requestsFor('/api/v1/events')
      .map((request) => request.headers.authorization)
    expect(auths[0]).toBe('Bearer tok-1')
    expect(auths[1]).toBe('Bearer tok-2')
    expect(auths[2]).toBe('Bearer tok-3')
  })

  it('stops reconnecting after a terminal completion event', async () => {
    let connections = 0
    const fixture = await createFixture((_request, response) => {
      connections += 1
      openSse(response)
      writeSseEvent(response, {
        id: 'done-1',
        event: 'job.progress',
        data: JSON.stringify({
          ...backgroundEvent('done-1'),
          payload: { channel: 'jobs', status: 'completed' },
        }),
      })
      response.end()
    })
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })
    const subscription = client.events({ retry: FAST_RETRY })
    await subscription.done
    expect(connections).toBe(1)
  })
})

describe('SSE robustness', () => {
  it('resolves done and surfaces an error when the auth context throws', async () => {
    const fixture = await createFixture((_request, response) => {
      openSse(response)
      response.end()
    })
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      auth: bearerAuthContext({
        surface: 'control',
        token: () => {
          throw new Error('token boom')
        },
      }),
    })
    const errors: ApiClientError[] = []
    const subscription = client.events({
      retry: SINGLE_RETRY,
      onError: (error) => errors.push(error),
    })
    await subscription.done
    expect(subscription.closed).toBe(true)
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0]?.code).toBe('NETWORK_ERROR')
  })

  it('isolates a throwing onEvent callback and still resolves done', async () => {
    const fixture = await createFixture((_request, response) => {
      openSse(response)
      writeSseEvent(response, {
        id: '1',
        event: 'job.progress',
        data: JSON.stringify(backgroundEvent('evt_1')),
      })
      response.end()
    })
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })
    const errors: ApiClientError[] = []
    const subscription = client.events({
      retry: SINGLE_RETRY,
      onEvent: () => {
        throw new Error('handler boom')
      },
      onError: (error) => errors.push(error),
    })
    await subscription.done
    expect(subscription.closed).toBe(true)
    expect(errors.some((error) => error.code === 'SSE_ERROR')).toBe(true)
  })

  it('survives an onError callback that also throws', async () => {
    const fixture = await createFixture((_request, response) => {
      sendJson(response, 503, navinError('SERVICE_UNAVAILABLE', 'down', { retryable: true }))
    })
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })
    const subscription = client.events({
      retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitter: 'none' },
      onError: () => {
        throw new Error('onError boom')
      },
    })
    await subscription.done
    expect(subscription.closed).toBe(true)
  })

  it('resolves done when the transport body is missing', async () => {
    const client = new ControlApiClient({
      baseUrl: 'https://admin.example.com',
      retry: SINGLE_RETRY,
      transport: {
        async send() {
          return {
            status: 200,
            ok: true,
            headers: new Headers(),
            text: async () => '',
            body: null,
          }
        },
      },
    })
    const errors: ApiClientError[] = []
    const subscription = client.events({ onError: (error) => errors.push(error) })
    await subscription.done
    expect(subscription.closed).toBe(true)
    expect(errors.some((error) => error.code === 'SSE_ERROR')).toBe(true)
  })
})

describe('bounded bodies', () => {
  it('rejects an oversized REST response body', async () => {
    const fixture = await createFixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ...healthResponse(), pad: 'x'.repeat(5_000) }))
    })
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      maxResponseBytes: 200,
      retry: false,
    })
    await expect(client.health()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('caps the stored error response body', async () => {
    const fixture = await createFixture((_request, response) => {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end('E'.repeat(4_000))
    })
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      maxErrorBodyBytes: 100,
      retry: false,
    })
    const error = await client.health().catch((caught: unknown) => caught as ApiClientError)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(
      utf8ByteLength(error instanceof ApiClientError ? (error.responseBody ?? '') : ''),
    ).toBeLessThanOrEqual(100)
  })

  it('rejects an oversized SSE event', async () => {
    const fixture = await createFixture((_request, response) => {
      openSse(response)
      writeSseEvent(response, {
        id: '1',
        event: 'job.progress',
        data: JSON.stringify({ ...backgroundEvent('evt_1'), pad: 'x'.repeat(5_000) }),
      })
      response.end()
    })
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl, maxSseEventBytes: 200 })
    const errors: ApiClientError[] = []
    const subscription = client.events({
      retry: SINGLE_RETRY,
      onError: (error) => errors.push(error),
    })
    await subscription.done
    expect(errors.some((error) => error.code === 'SSE_ERROR')).toBe(true)
  })

  it('bounds the SSE parser buffer directly', () => {
    const parser = createSseParser(50)
    expect(() => parser.push(`data: ${'x'.repeat(100)}\n\n`)).toThrow(ApiSseError)
  })
})
