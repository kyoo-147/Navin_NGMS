import { afterEach, describe, expect, it } from 'vitest'
import type { SaslCredentials } from '../src/common/sasl.js'
import { ImapClient } from '../src/imap/client.js'
import { startImapFixture, type ImapFixture } from './support/imap-fixture.js'
import { loadFixtureCertificate } from './support/tls.js'

const certificate = loadFixtureCertificate()
const fixtures: ImapFixture[] = []
const clients: ImapClient[] = []
const credentials: SaslCredentials = { username: 'alice@example.test', password: 'secret' }

async function fixture(options?: Parameters<typeof startImapFixture>[0]): Promise<ImapFixture> {
  const created = await startImapFixture(options)
  fixtures.push(created)
  return created
}

async function connect(
  server: ImapFixture,
  options?: Partial<Parameters<typeof ImapClient.connect>[0]>,
): Promise<ImapClient> {
  const client = await ImapClient.connect({
    host: '127.0.0.1',
    port: server.port,
    unsafeAllowInsecureAuthForTests: true,
    ...options,
  })
  clients.push(client)
  return client
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  await Promise.all(fixtures.splice(0).map((server) => server.close()))
})

describe('ImapClient', () => {
  it('reads capabilities from the greeting and authenticates with LOGIN', async () => {
    const server = await fixture({ capabilities: ['IMAP4rev1', 'AUTH=PLAIN', 'AUTH=LOGIN'] })
    const client = await connect(server)
    expect(client.capabilities.has('IMAP4rev1')).toBe(true)
    expect(client.capabilities.supportsAuth('PLAIN')).toBe(true)

    await client.login('alice@example.test', 'secret')
    expect(client.isAuthenticated).toBe(true)

    const selected = await client.command('SELECT', 'INBOX')
    expect(selected.status).toBe('OK')
  })

  it('never sends LOGIN or AUTH on an unencrypted connection', async () => {
    const server = await fixture({ capabilities: ['IMAP4rev1', 'AUTH=PLAIN', 'AUTH=LOGIN'] })
    const client = await ImapClient.connect({ host: '127.0.0.1', port: server.port })
    clients.push(client)

    await expect(client.login('alice@example.test', 'secret')).rejects.toMatchObject({
      code: 'TLS_REQUIRED',
    })
    await expect(client.authenticate('PLAIN', credentials)).rejects.toMatchObject({
      code: 'TLS_REQUIRED',
    })
    expect(server.loginAttempts).toBe(0)
    expect(server.authAttempts).toBe(0)
  })

  it('rejects CR/LF/NUL in public command fields before writing', async () => {
    const server = await fixture()
    const client = await connect(server)
    await expect(client.command('NOOP\r\nLOGIN', 'x\0y')).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
    })
    expect(server.loginAttempts).toBe(0)
  })

  it('refuses LOGIN while the server advertises LOGINDISABLED', async () => {
    const server = await fixture()
    const client = await connect(server)
    expect(client.capabilities.loginDisabled).toBe(true)
    await expect(client.login('alice@example.test', 'secret')).rejects.toMatchObject({
      code: 'TLS_REQUIRED',
    })
    expect(server.loginAttempts).toBe(0)
  })

  it('authenticates with SASL PLAIN', async () => {
    const server = await fixture({ capabilities: ['IMAP4rev1', 'AUTH=PLAIN'] })
    const client = await connect(server)
    await client.authenticate('PLAIN', credentials)
    expect(client.isAuthenticated).toBe(true)
    expect(server.authAttempts).toBe(1)
  })

  it('authenticates with SASL LOGIN using server continuations', async () => {
    const server = await fixture({ capabilities: ['IMAP4rev1', 'AUTH=LOGIN'] })
    const client = await connect(server)
    await client.authenticate('LOGIN', credentials)
    expect(client.isAuthenticated).toBe(true)
  })

  it('reports bad credentials via AUTH_FAILED', async () => {
    const server = await fixture({ capabilities: ['IMAP4rev1', 'AUTH=PLAIN'] })
    const client = await connect(server)
    await expect(
      client.authenticate('PLAIN', { username: 'alice@example.test', password: 'wrong' }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('refuses a mechanism the server does not advertise', async () => {
    const server = await fixture({ capabilities: ['IMAP4rev1'] })
    const client = await connect(server)
    await expect(client.authenticate('PLAIN', credentials)).rejects.toMatchObject({
      code: 'AUTH_UNSUPPORTED',
    })
  })

  it.skipIf(certificate === null)('upgrades with STARTTLS and re-reads capabilities', async () => {
    const server = await fixture({ certificate })
    const client = await connect(server, { tls: 'none', tlsOptions: { rejectUnauthorized: false } })
    expect(client.isEncrypted).toBe(false)
    expect(client.capabilities.startTls).toBe(true)

    await client.startTls()
    expect(client.isEncrypted).toBe(true)
    expect(client.capabilities.startTls).toBe(false)
    expect(client.capabilities.loginDisabled).toBe(false)

    await client.login('alice@example.test', 'secret')
    expect(client.isAuthenticated).toBe(true)
  })

  it('times out a stalled command and closes the connection', async () => {
    const server = await fixture({ silentCommands: ['NOOP'] })
    const client = await connect(server)
    await expect(client.command('NOOP', undefined, { timeoutMs: 80 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
  })

  it('honors an external abort signal', async () => {
    const server = await fixture({ silentCommands: ['NOOP'] })
    const client = await connect(server)
    const controller = new AbortController()
    const pending = client.command('NOOP', undefined, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('fails the connection when the server greets with BYE', async () => {
    const server = await fixture({ greeting: '* BYE server under maintenance' })
    await expect(
      ImapClient.connect({ host: '127.0.0.1', port: server.port }),
    ).rejects.toMatchObject({
      code: 'CONNECT_FAILED',
    })
  })

  it('logs out and records the terminal state', async () => {
    const server = await fixture({ capabilities: ['IMAP4rev1', 'AUTH=PLAIN'] })
    const client = await connect(server)
    await client.login('alice@example.test', 'secret')
    const result = await client.logout()
    expect(result.status).toBe('OK')
    expect(client.state).toBe('logout')
  })
})
