import { afterEach, describe, expect, it } from 'vitest'
import type { SaslCredentials } from '../src/common/sasl.js'
import { SmtpClient } from '../src/smtp/client.js'
import { startSmtpFixture, type SmtpFixture } from './support/smtp-fixture.js'
import { loadFixtureCertificate } from './support/tls.js'

const certificate = loadFixtureCertificate()
const fixtures: SmtpFixture[] = []
const clients: SmtpClient[] = []
const credentials: SaslCredentials = { username: 'alice@example.test', password: 'secret' }

async function fixture(options?: Parameters<typeof startSmtpFixture>[0]): Promise<SmtpFixture> {
  const created = await startSmtpFixture(options)
  fixtures.push(created)
  return created
}

async function connect(
  server: SmtpFixture,
  options?: Partial<Parameters<typeof SmtpClient.connect>[0]>,
): Promise<SmtpClient> {
  const client = await SmtpClient.connect({
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

describe('SmtpClient', () => {
  it('never sends AUTH on an unencrypted connection', async () => {
    const server = await fixture()
    const client = await SmtpClient.connect({ host: '127.0.0.1', port: server.port })
    clients.push(client)
    await expect(client.authenticate('PLAIN', credentials)).rejects.toMatchObject({
      code: 'TLS_REQUIRED',
    })
    expect(server.authAttempts).toBe(0)
  })

  it('rejects CR/LF/NUL in helloName before connecting', async () => {
    const server = await fixture()
    await expect(
      SmtpClient.connect({
        host: '127.0.0.1',
        port: server.port,
        helloName: `safe\r\nAUTH PLAIN ${Buffer.from('leak').toString('base64')}\0`,
      }),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    expect(server.authAttempts).toBe(0)
  })

  it('parses EHLO capabilities', async () => {
    const server = await fixture({ certificate })
    const client = await connect(server)
    expect(client.capabilities.eightBitMime).toBe(true)
    expect(client.capabilities.pipelining).toBe(true)
    expect(client.capabilities.supportsAuth('PLAIN')).toBe(true)
    expect(client.capabilities.supportsAuth('LOGIN')).toBe(true)
    expect(client.capabilities.sizeLimit).toBe(10_485_760)
    expect(client.capabilities.startTls).toBe(certificate !== null)
  })

  it.skipIf(certificate === null)('upgrades with STARTTLS and authenticates PLAIN', async () => {
    const server = await fixture({ certificate })
    const client = await connect(server, { tlsOptions: { rejectUnauthorized: false } })
    expect(client.capabilities.startTls).toBe(true)

    await client.startTls()
    expect(client.isEncrypted).toBe(true)
    expect(client.capabilities.startTls).toBe(false)

    await client.authenticate('PLAIN', credentials)
    expect(server.authAttempts).toBe(1)
  })

  it.skipIf(certificate === null)(
    'terminally closes after a failed STARTTLS handshake',
    async () => {
      const server = await fixture({ certificate })
      const client = await connect(server, { tlsOptions: { rejectUnauthorized: true } })
      await expect(client.startTls({ timeoutMs: 500 })).rejects.toMatchObject({
        code: 'TLS_FAILED',
      })
      await expect(client.ehlo()).rejects.toMatchObject({ code: 'TLS_FAILED' })
    },
  )

  it('authenticates with SASL LOGIN', async () => {
    const server = await fixture()
    const client = await connect(server)
    await client.authenticate('LOGIN', credentials)
    expect(server.authAttempts).toBe(1)
  })

  it('reports authentication failure', async () => {
    const server = await fixture()
    const client = await connect(server)
    await expect(
      client.authenticate('PLAIN', { username: 'alice@example.test', password: 'wrong' }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('runs a full transaction and preserves dotted-body lines', async () => {
    const server = await fixture()
    const client = await connect(server)

    const result = await client.sendTransaction({
      from: 'alice@example.test',
      to: ['bob@example.test'],
      cc: ['carol@example.test'],
      subject: 'W16 fixture message',
      text: 'Line one\r\n.\r\nLine three',
    })

    expect(result.acceptedRecipients).toEqual(['bob@example.test', 'carol@example.test'])
    expect(server.messages).toHaveLength(1)
    const received = server.messages[0]
    expect(received?.from).toBe('alice@example.test')
    expect(received?.recipients).toEqual(['bob@example.test', 'carol@example.test'])

    const body = received?.data.toString('utf8') ?? ''
    expect(body).toContain('Subject: W16 fixture message')
    expect(body).toContain('Line one\r\n.\r\nLine three')
    expect(body).not.toContain('\r\n..\r\n')
  })

  it('rejects a bad recipient and resets the transaction', async () => {
    const server = await fixture({ failRecipients: ['bob@example.test'] })
    const client = await connect(server)

    await expect(
      client.sendTransaction({
        from: 'alice@example.test',
        to: ['bob@example.test'],
        subject: 'nope',
        text: 'body',
      }),
    ).rejects.toMatchObject({ code: 'RECIPIENT_REJECTED' })

    expect(server.messages).toHaveLength(0)
    const reset = await client.mailFrom('alice@example.test')
    expect(reset.code).toBe(250)
  })

  it('bounds multiline replies by aggregate lines and bytes', async () => {
    const lineLimited = await fixture({ ehloExtraLines: 8 })
    await expect(
      SmtpClient.connect({
        host: '127.0.0.1',
        port: lineLimited.port,
        limits: { maxResponseLines: 3 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const byteLimited = await fixture({ ehloExtraLines: 2 })
    await expect(
      SmtpClient.connect({
        host: '127.0.0.1',
        port: byteLimited.port,
        limits: { maxResponseBytes: 40 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('uses one deadline across slow multiline replies', async () => {
    const server = await fixture({ ehloExtraLines: 8, ehloReplyDelayMs: 25 })
    const startedAt = Date.now()
    await expect(
      SmtpClient.connect({
        host: '127.0.0.1',
        port: server.port,
        limits: { commandTimeoutMs: 80 },
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(Date.now() - startedAt).toBeLessThan(250)
  })

  it('enforces the advertised SIZE limit before sending', async () => {
    const server = await fixture({ sizeLimit: 16 })
    const client = await connect(server)

    await expect(
      client.sendTransaction({
        from: 'alice@example.test',
        to: ['bob@example.test'],
        subject: 'too large',
        text: 'x'.repeat(200),
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(server.messages).toHaveLength(0)
  })

  it('rejects a locally oversized DATA payload before issuing DATA', async () => {
    const server = await fixture()
    const client = await connect(server, { limits: { maxMessageBytes: 64 } })
    await expect(
      client.sendTransaction({
        from: 'alice@example.test',
        to: ['bob@example.test'],
        subject: 'too large locally',
        text: 'x'.repeat(200),
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(server.dataAttempts).toBe(0)
  })

  it('times out a stalled DATA prompt', async () => {
    const server = await fixture({ silentCommands: ['DATA'] })
    const client = await connect(server)

    await expect(
      client.sendTransaction(
        {
          from: 'alice@example.test',
          to: ['bob@example.test'],
          subject: 'stall',
          text: 'body',
        },
        { timeoutMs: 80 },
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('quits with a 221 reply', async () => {
    const server = await fixture()
    const client = await connect(server)
    const reply = await client.quit()
    expect(reply.code).toBe(221)
  })
})
