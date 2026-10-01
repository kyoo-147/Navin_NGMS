import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { BearerTokenAuth, EngineError, HttpTransport } from '../src/index.js'

interface CapturedHttpRequest {
  method: string
  path: string
  headers: Record<string, string | undefined>
  body: string
}

interface TestServer {
  url: string
  requests: CapturedHttpRequest[]
  close: () => Promise<void>
}

const openServers: TestServer[] = []

async function makeServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestServer> {
  const requests: CapturedHttpRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers: req.headers as Record<string, string | undefined>,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      handler(req, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no bound port')
  const testServer: TestServer = {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
  openServers.push(testServer)
  return testServer
}

function respond(
  res: ServerResponse,
  status: number,
  body: unknown,
  contentType = 'application/json',
) {
  res.writeHead(status, { 'content-type': contentType })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

afterEach(async () => {
  while (openServers.length > 0) {
    const server = openServers.pop()
    if (server) await server.close()
  }
})

describe('secure HTTP transport', () => {
  it('refuses insecure HTTP to a non-loopback host but allows loopback fixtures', async () => {
    expect(() => new HttpTransport({ baseUrl: 'http://mail.test' })).toThrowError(EngineError)

    const server = await makeServer((_req, res) => respond(res, 200, { ok: true }))
    const transport = new HttpTransport({ baseUrl: server.url })
    expect(transport.secure).toBe(false)
  })

  it('rejects ambiguous endpoints and unsafe URL components', () => {
    const endpoints = [
      '/relative',
      'ftp://mail.test',
      'http://localhost:1234',
      'http://127.1:1234',
      'http://2130706433:1234',
      'https://user:pass@mail.test',
      'https://mail.test?token=secret',
      'https://mail.test/#fragment',
      'https://mail.test/api/../admin',
      'https://mail.test/api/%2e%2e/admin',
    ]
    for (const baseUrl of endpoints) {
      expect(() => new HttpTransport({ baseUrl, allowInsecureHttp: true })).toThrowError(
        EngineError,
      )
    }
  })

  it('rejects reserved caller headers and unsafe request paths', async () => {
    const server = await makeServer((_req, res) => respond(res, 200, { ok: true }))
    const transport = new HttpTransport({ baseUrl: server.url })
    for (const header of ['Authorization', 'Host', 'Content-Length', 'User-Agent']) {
      await expect(
        transport.request({ method: 'GET', path: '/' }, { headers: { [header]: 'override' } }),
      ).rejects.toMatchObject({ category: 'validation' })
    }
    for (const path of [
      '/api?redirect=https://mail.test',
      '/api#fragment',
      '/api/../admin',
      '/api/%2e%2e/admin',
    ]) {
      await expect(transport.request({ method: 'GET', path })).rejects.toMatchObject({
        category: 'validation',
      })
    }
    expect(server.requests).toHaveLength(0)
  })

  it('attaches auth and idempotency headers and returns parsed JSON', async () => {
    const server = await makeServer((_req, res) => respond(res, 200, { ok: true }))
    const transport = new HttpTransport({
      baseUrl: server.url,
      auth: new BearerTokenAuth('secret'),
    })

    const response = await transport.request<{ ok: boolean }>(
      { method: 'POST', path: '/api', body: { hello: 'world' } },
      { idempotencyKey: 'idem-1' },
    )

    expect(response.data.ok).toBe(true)
    const captured = server.requests[0]
    expect(captured?.headers.authorization).toBe('Bearer secret')
    expect(captured?.headers['idempotency-key']).toBe('idem-1')
    expect(captured?.body).toBe(JSON.stringify({ hello: 'world' }))
  })

  it('normalizes HTTP status codes into engine error categories', async () => {
    const server = await makeServer((req, res) => {
      const map: Record<string, [number, unknown]> = {
        '/unauth': [401, { message: 'nope' }],
        '/missing': [404, { message: 'gone' }],
        '/conflict': [409, { message: 'dup' }],
        '/rate': [429, { message: 'slow' }],
        '/boom': [500, { message: 'broken' }],
        '/bad': [400, { message: 'invalid' }],
      }
      const entry = map[req.url ?? ''] ?? [404, { message: 'unknown' }]
      respond(res, entry[0], entry[1])
    })
    const transport = new HttpTransport({ baseUrl: server.url, retry: { attempts: 1 } })

    const cases: Array<[string, string]> = [
      ['/unauth', 'unauthenticated'],
      ['/missing', 'not_found'],
      ['/conflict', 'conflict'],
      ['/rate', 'rate_limited'],
      ['/boom', 'unavailable'],
      ['/bad', 'validation'],
    ]
    for (const [path, category] of cases) {
      await expect(transport.request({ method: 'GET', path })).rejects.toMatchObject({ category })
    }
  })

  it('returns plain text bodies without JSON parsing', async () => {
    const server = await makeServer((_req, res) => respond(res, 200, 'hello', 'text/plain'))
    const transport = new HttpTransport({ baseUrl: server.url })
    const response = await transport.request<string>({ method: 'GET', path: '/' })
    expect(response.data).toBe('hello')
  })

  it('rejects an oversized response', async () => {
    const server = await makeServer((_req, res) => respond(res, 200, { blob: 'x'.repeat(500) }))
    const transport = new HttpTransport({ baseUrl: server.url, maxResponseBytes: 32 })
    await expect(transport.request({ method: 'GET', path: '/big' })).rejects.toMatchObject({
      category: 'protocol',
    })
  })

  it('aborts a request on timeout and on external cancellation', async () => {
    const server = await makeServer((_req, res) => {
      setTimeout(() => respond(res, 200, { ok: true }), 200)
    })
    const transport = new HttpTransport({ baseUrl: server.url, retry: { attempts: 1 } })

    await expect(
      transport.request({ method: 'GET', path: '/' }, { timeoutMs: 30 }),
    ).rejects.toMatchObject({ category: 'timeout' })

    const controller = new AbortController()
    const pending = transport.request(
      { method: 'GET', path: '/' },
      { signal: controller.signal, timeoutMs: 5_000 },
    )
    setTimeout(() => controller.abort(), 20)
    await expect(pending).rejects.toMatchObject({ category: 'cancelled' })
  })

  it('retries idempotent requests but not unkeyed mutations', async () => {
    let hits = 0
    const server = await makeServer((_req, res) => {
      hits += 1
      if (hits === 1) {
        respond(res, 503, { message: 'warming' })
        return
      }
      respond(res, 200, { ok: true })
    })
    const transport = new HttpTransport({
      baseUrl: server.url,
      retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 5 },
    })

    const response = await transport.request<{ ok: boolean }>({ method: 'GET', path: '/' })
    expect(response.data.ok).toBe(true)
    expect(response.attempts).toBe(2)

    const failing = await makeServer((_req, res) => respond(res, 503, { message: 'down' }))
    const failingTransport = new HttpTransport({
      baseUrl: failing.url,
      retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
    })
    await expect(
      failingTransport.request({ method: 'POST', path: '/', body: {} }),
    ).rejects.toMatchObject({ category: 'unavailable' })
    expect(failing.requests.length).toBe(1)
  })

  it('does not follow redirects', async () => {
    const server = await makeServer((_req, res) => {
      res.writeHead(302, { location: 'http://mail.test/elsewhere' })
      res.end()
    })
    const transport = new HttpTransport({ baseUrl: server.url, retry: { attempts: 1 } })

    await expect(transport.request({ method: 'GET', path: '/' })).rejects.toMatchObject({
      category: 'protocol',
    })
    expect(server.requests.length).toBe(1)
  })
})
