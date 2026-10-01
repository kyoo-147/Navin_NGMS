import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonLogger } from '../src/adapters/json-logger.js'
import { RandomIdGenerator } from '../src/adapters/random-id-generator.js'
import { loadConfig } from '../src/config/config.js'
import { DefaultHealthRegistry } from '../src/health/registry.js'
import { buildServer } from '../src/http/server.js'
import { requestPath } from '../src/http/plugins.js'
import { CaptureSink, FixedClock } from './support/test-helpers.js'

interface TestServer {
  server: FastifyInstance
  health: DefaultHealthRegistry
  sink: CaptureSink
}

let active: FastifyInstance | undefined

function createTestServer(): TestServer {
  const clock = new FixedClock()
  const sink = new CaptureSink()
  const logger = new JsonLogger({ level: 'debug', clock, sink })
  const health = new DefaultHealthRegistry(clock)
  const config = loadConfig({ env: {} })
  const server = buildServer({
    config,
    logger,
    clock,
    ids: new RandomIdGenerator(),
    health,
    startedAt: Date.now(),
  })
  active = server
  return { server, health, sink }
}

afterEach(async () => {
  if (active) {
    await active.close()
    active = undefined
  }
})

describe('requestPath', () => {
  it('strips the query string', () => {
    expect(requestPath('/health?token=abc')).toBe('/health')
    expect(requestPath('/ready')).toBe('/ready')
    expect(requestPath('/a?b=c?d')).toBe('/a')
  })
})

describe('HTTP server', () => {
  it('reports liveness and echoes a valid correlation id', async () => {
    const { server } = createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'client-corr-1' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['x-correlation-id']).toBe('client-corr-1')
    const body = response.json() as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(body.correlationId).toBe('client-corr-1')
  })

  it('generates a correlation id when the header is absent or invalid', async () => {
    const { server } = createTestServer()

    const generated = await server.inject({ method: 'GET', url: '/health' })
    expect(String((generated.json() as Record<string, unknown>).correlationId)).toMatch(/^req_/)

    const rejected = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'has spaces' },
    })
    expect(String((rejected.json() as Record<string, unknown>).correlationId)).toMatch(/^req_/)
  })

  it('reports readiness from registered checks', async () => {
    const { server, health } = createTestServer()
    health.register({ name: 'database', critical: true, check: () => ({ state: 'healthy' }) })

    const ready = await server.inject({ method: 'GET', url: '/ready' })
    expect(ready.statusCode).toBe(200)
    expect((ready.json() as { status: string }).status).toBe('ready')

    health.register({
      name: 'database',
      critical: true,
      check: () => ({ state: 'unhealthy', message: 'down' }),
    })

    const notReady = await server.inject({ method: 'GET', url: '/ready' })
    expect(notReady.statusCode).toBe(503)
    expect((notReady.json() as { status: string }).status).toBe('not_ready')
  })

  it('returns a structured 404 envelope for unknown routes', async () => {
    const { server } = createTestServer()
    const response = await server.inject({ method: 'GET', url: '/does-not-exist' })

    expect(response.statusCode).toBe(404)
    const body = response.json() as { error: Record<string, unknown> }
    expect(body.error.code).toBe('NOT_FOUND')
    expect(typeof body.error.correlationId).toBe('string')
    expect(typeof body.error.timestamp).toBe('string')
  })

  it('maps thrown errors to envelopes without leaking internals', async () => {
    const { server } = createTestServer()
    server.get('/boom', () => {
      throw new Error('kaboom')
    })
    server.get('/teapot', () => {
      throw Object.assign(new Error('bad input'), { statusCode: 400 })
    })

    const serverError500 = await server.inject({ method: 'GET', url: '/boom' })
    expect(serverError500.statusCode).toBe(500)
    expect((serverError500.json() as { error: { code: string; message: string } }).error.code).toBe(
      'INTERNAL_ERROR',
    )
    expect(
      (serverError500.json() as { error: { code: string; message: string } }).error.message,
    ).toBe('Internal server error')

    const clientError = await server.inject({ method: 'GET', url: '/teapot' })
    expect(clientError.statusCode).toBe(400)
    expect((clientError.json() as { error: { code: string } }).error.code).toBe('BAD_REQUEST')
  })

  it('logs each request with its correlation id and status', async () => {
    const { server, sink } = createTestServer()
    await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'log-corr' },
    })

    const record = sink.records().find((entry) => entry.msg === 'http request')
    expect(record).toBeDefined()
    expect(record?.correlationId).toBe('log-corr')
    expect(record?.statusCode).toBe(200)
  })

  it('never logs query strings or credentials', async () => {
    const { server, sink } = createTestServer()
    const response = await server.inject({
      method: 'GET',
      url: '/health?token=supersecrettoken123&api_key=abc123',
      headers: { authorization: 'Bearer abc.def.ghi', 'x-correlation-id': 'q-corr' },
    })

    expect(response.statusCode).toBe(200)
    const dumped = sink.lines.join('\n')
    expect(dumped).not.toContain('supersecrettoken123')
    expect(dumped).not.toContain('abc123')
    expect(dumped).not.toContain('abc.def.ghi')

    const record = sink.records().find((entry) => entry.msg === 'http request')
    expect(record?.path).toBe('/health')
    expect(record?.url).toBeUndefined()
  })

  it('logs the failing request path without its query string', async () => {
    const { server, sink } = createTestServer()
    server.get('/boom', () => {
      throw new Error('kaboom')
    })

    const response = await server.inject({
      method: 'GET',
      url: '/boom?token=supersecrettoken123',
    })

    expect(response.statusCode).toBe(500)
    const record = sink.records().find((entry) => entry.msg === 'request failed')
    expect(record?.path).toBe('/boom')
    expect(sink.lines.join('\n')).not.toContain('supersecrettoken123')
  })
})
