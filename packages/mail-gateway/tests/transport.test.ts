import { afterEach, describe, it, expect } from 'vitest'
import { JmapClient, JmapHttpTransport } from '../src/index.js'
import { startJmapFixture, type JmapFixture } from './fixtures/jmap-fixture.js'

const fixtures: JmapFixture[] = []

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()
    if (fixture) await fixture.stop()
  }
})

async function fixture(options: Parameters<typeof startJmapFixture>[0] = {}): Promise<JmapFixture> {
  const started = await startJmapFixture(options)
  fixtures.push(started)
  return started
}

describe('JmapHttpTransport', () => {
  it('fails with a retryable timeout when the upstream is too slow', async () => {
    const server = await fixture({ latencyMs: 300 })
    const transport = new JmapHttpTransport({ timeoutMs: 30 })
    await expect(
      transport.send({ url: server.sessionUrl, method: 'GET', headers: {} }),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true,
      details: { reason: 'timeout' },
    })
  })

  it('reports caller aborts distinctly from timeouts', async () => {
    const server = await fixture({ latencyMs: 300 })
    const controller = new AbortController()
    controller.abort()
    const transport = new JmapHttpTransport({ timeoutMs: 5000 })
    await expect(
      transport.send({
        url: server.sessionUrl,
        method: 'GET',
        headers: {},
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ details: { reason: 'aborted' } })
  })

  it('maps connection failures to a retryable network error', async () => {
    const server = await fixture()
    const url = server.sessionUrl
    await server.stop()
    fixtures.pop()
    const transport = new JmapHttpTransport({ timeoutMs: 1000 })
    await expect(transport.send({ url, method: 'GET', headers: {} })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: { reason: 'network' },
    })
  })
})

describe('JmapClient', () => {
  it('bootstraps a session and negotiates capabilities', async () => {
    const server = await fixture()
    const client = await JmapClient.connect({
      credential: { sessionUrl: server.sessionUrl, authorization: 'unused' },
    })
    expect(client.supports('urn:ietf:params:jmap:mail')).toBe(true)
    expect(client.account(server.accountId).isPersonal).toBe(true)
    expect(() => client.account('missing')).toThrowError(/not present/)
  })

  it('maps request-level HTTP failures to Navin errors', async () => {
    const server = await fixture({ apiStatus: 503 })
    const client = await JmapClient.connect({
      credential: { sessionUrl: server.sessionUrl, authorization: 'unused' },
    })
    await expect(
      client.invokeOne('Email/query', { accountId: server.accountId, position: 0, limit: 10 }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })

  it('fails closed on 401 from the session endpoint', async () => {
    const server = await fixture({ authorization: 'Basic expected' })
    await expect(
      JmapClient.connect({
        credential: { sessionUrl: server.sessionUrl, authorization: 'Basic wrong' },
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('surfaces JMAP method errors with mapped codes', async () => {
    const server = await fixture()
    const client = await JmapClient.connect({
      credential: { sessionUrl: server.sessionUrl, authorization: 'unused' },
    })
    await expect(
      client.invokeOne('Email/get', { accountId: 'does-not-exist', ids: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', details: { jmapErrorType: 'accountNotFound' } })
  })

  it('maps upstream state mismatches to CONFLICT', async () => {
    const server = await fixture()
    const client = await JmapClient.connect({
      credential: { sessionUrl: server.sessionUrl, authorization: 'unused' },
    })
    await expect(
      client.invokeOne('Email/set', {
        accountId: server.accountId,
        ifInState: 'es999',
        update: {},
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { jmapErrorType: 'stateMismatch' } })
  })
})
