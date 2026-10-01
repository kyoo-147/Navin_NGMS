import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeId } from '@navin/mail-gateway'
import { getFreePort, startNavind, type NavindProcess } from './support/spawn-server.js'
import { createTempDir, removeTempDir } from './support/test-helpers.js'
import { startJmapUpstream } from './support/jmap-fixture.js'

const MAIL_EMAIL = 'user@example.org'
const MAIL_PASSWORD = 'correct-horse-battery-staple-1234'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    if (cleanup) await cleanup()
  }
})

function mailHeaders(token?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-navin-surface': 'mail',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

interface MailSessionInfo {
  username: string
  accounts: Array<{ accountId: string; mailCapable: boolean }>
  primaryAccountId: string | null
  sender: { identityId: string; address: string } | null
}

describe('navind Mail BFF process & SQLite integration', () => {
  it('serves the mail BFF end to end against a real upstream with fail-closed auth and idempotency', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin-mail.db')
    const upstream = await startJmapUpstream()
    const port = await getFreePort()

    const proc = await startNavind({
      port,
      env: {
        NAVIN_DATABASE_PATH: databasePath,
        NAVIN_ENVIRONMENT: 'test',
        NAVIN_LOG_LEVEL: 'warn',
        NAVIN_MAIL_JMAP_SESSION_URL: upstream.sessionUrl,
        NAVIN_MAIL_JMAP_AUTHORIZATION: upstream.authorization,
        NAVIN_MAIL_ACCOUNT_EMAIL: MAIL_EMAIL,
        NAVIN_MAIL_SENDER_IDENTITY_ID: encodeId('als', 'id1'),
        NAVIN_MAIL_BOOTSTRAP_EMAIL: MAIL_EMAIL,
        NAVIN_MAIL_BOOTSTRAP_PASSWORD: MAIL_PASSWORD,
      },
    })
    cleanups.push(() => proc.kill())
    cleanups.push(() => upstream.stop())
    cleanups.push(() => removeTempDir(dir))

    const base = `http://127.0.0.1:${port}`

    // Unauthenticated mail access is rejected.
    const anonymous = await fetch(`${base}/api/v1/mail/session`, { headers: mailHeaders() })
    expect(anonymous.status).toBe(401)

    // Mail login issues a mail-relying-party session with mail scopes.
    const loginRes = await fetch(`${base}/api/v1/mail/auth/login`, {
      method: 'POST',
      headers: mailHeaders(),
      body: JSON.stringify({ email: MAIL_EMAIL, password: MAIL_PASSWORD }),
    })
    expect(loginRes.status).toBe(200)
    expect(loginRes.headers.get('set-cookie')).toContain('__Host-navin_mail_session')
    const login = (await loginRes.json()) as {
      token: string
      principal: { roles: string[]; scopes: string[] }
    }
    expect(login.token).toBeTruthy()
    expect(login.principal.roles).toContain('mail.user')
    expect(login.principal.scopes).toContain('mail:read')

    // Identity session confirms the mail surface.
    const identityRes = await fetch(`${base}/api/v1/mail/auth/session`, {
      headers: mailHeaders(login.token),
    })
    expect(identityRes.status).toBe(200)
    expect(((await identityRes.json()) as { surface: string }).surface).toBe('mail')

    // A non-mail surface cannot use a mail token.
    const wrongSurface = await fetch(`${base}/api/v1/mail/session`, {
      headers: { ...mailHeaders(login.token), 'x-navin-surface': 'control' },
    })
    expect(wrongSurface.status).toBe(403)

    // Normalized upstream engine session (credential stays server-side).
    const engineRes = await fetch(`${base}/api/v1/mail/session`, {
      headers: mailHeaders(login.token),
    })
    expect(engineRes.status).toBe(200)
    const engine = (await engineRes.json()) as MailSessionInfo
    expect(engine.accounts).toHaveLength(1)
    expect(engine.primaryAccountId).toBeTruthy()
    const accountId = engine.primaryAccountId as string
    expect(accountId).toBe(encodeId('acc', upstream.accountId))

    // The compose/send binding is server-authoritative, not client-supplied.
    expect(engine.sender).toEqual({ identityId: encodeId('als', 'id1'), address: MAIL_EMAIL })

    // Mailboxes.
    const mailboxRes = await fetch(
      `${base}/api/v1/mail/mailboxes?accountId=${encodeURIComponent(accountId)}`,
      { headers: mailHeaders(login.token) },
    )
    expect(mailboxRes.status).toBe(200)
    const mailboxes = (await mailboxRes.json()) as {
      mailboxes: Array<{ id: string; role: string; unreadEmails: number }>
    }
    const inbox = mailboxes.mailboxes.find((mailbox) => mailbox.role === 'inbox')
    expect(inbox).toBeDefined()

    // Query the inbox and read one message.
    const queryRes = await fetch(`${base}/api/v1/mail/query`, {
      method: 'POST',
      headers: mailHeaders(login.token),
      body: JSON.stringify({
        accountId,
        position: 0,
        limit: 50,
        filter: { inMailbox: inbox?.id },
      }),
    })
    expect(queryRes.status).toBe(200)
    const query = (await queryRes.json()) as { messageIds: string[]; total: number }
    expect(query.messageIds.length).toBeGreaterThan(0)

    const messageRes = await fetch(
      `${base}/api/v1/mail/messages/${encodeURIComponent(query.messageIds[0]!)}?accountId=${encodeURIComponent(accountId)}`,
      { headers: mailHeaders(login.token) },
    )
    expect(messageRes.status).toBe(200)
    const message = (await messageRes.json()) as { id: string; subject: string; bodyHtml: string }
    expect(message.subject).toBeTruthy()
    expect(message.id).toBe(query.messageIds[0])

    // Idempotent mutation: replay returns the same result, a conflicting payload fails closed.
    const mutationBody = {
      accountId,
      idempotencyKey: 'idmp_mail_test_1',
      mutation: 'mark_read',
      targetIds: query.messageIds,
    }
    const mutateRes = await fetch(`${base}/api/v1/mail/mutations`, {
      method: 'POST',
      headers: mailHeaders(login.token),
      body: JSON.stringify(mutationBody),
    })
    expect(mutateRes.status).toBe(200)
    const mutation = (await mutateRes.json()) as {
      success: boolean
      affectedCount: number
      newState: string
    }
    expect(mutation.success).toBe(true)
    expect(mutation.affectedCount).toBe(query.messageIds.length)

    const replayRes = await fetch(`${base}/api/v1/mail/mutations`, {
      method: 'POST',
      headers: mailHeaders(login.token),
      body: JSON.stringify(mutationBody),
    })
    expect(replayRes.status).toBe(200)
    expect(((await replayRes.json()) as { newState: string }).newState).toBe(mutation.newState)

    const conflictRes = await fetch(`${base}/api/v1/mail/mutations`, {
      method: 'POST',
      headers: mailHeaders(login.token),
      body: JSON.stringify({ ...mutationBody, mutation: 'star' }),
    })
    expect(conflictRes.status).toBe(409)
    expect(((await conflictRes.json()) as { error: { code: string } }).error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    )

    // Submission reaches the upstream engine and returns a normalized ack.
    const submitRes = await fetch(`${base}/api/v1/mail/submissions`, {
      method: 'POST',
      headers: mailHeaders(login.token),
      body: JSON.stringify({
        accountId,
        idempotencyKey: 'idmp_mail_submit_1',
        senderIdentityId: encodeId('als', 'id1'),
        from: { name: 'Example User', address: MAIL_EMAIL },
        to: [{ address: 'bob@example.org' }],
        subject: 'Navin Mail BFF',
        bodyText: 'Hello from the BFF integration test.',
      }),
    })
    expect(submitRes.status).toBe(200)
    const submission = (await submitRes.json()) as { submissionId: string; messageId: string }
    expect(submission.submissionId).toMatch(/^sub_/)
    expect(submission.messageId).toMatch(/^msg_/)

    // Realtime: a completed mutation is delivered on the mail event stream.
    const controller = new AbortController()
    const streamRes = await fetch(`${base}/api/v1/mail/events`, {
      headers: { ...mailHeaders(login.token), accept: 'text/event-stream' },
      signal: controller.signal,
    })
    expect(streamRes.status).toBe(200)
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream')
    const reader = streamRes.body!.getReader()
    const decoder = new TextDecoder()

    await fetch(`${base}/api/v1/mail/mutations`, {
      method: 'POST',
      headers: mailHeaders(login.token),
      body: JSON.stringify({
        accountId,
        idempotencyKey: 'idmp_mail_event_1',
        mutation: 'star',
        targetIds: [query.messageIds[0]],
      }),
    })

    let streamText = ''
    const deadline = Date.now() + 8000
    while (!streamText.includes('mail.mutation.applied') && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      streamText += decoder.decode(value)
    }
    expect(streamText).toContain('mail.mutation.applied')
    controller.abort()
    await reader.cancel().catch(() => undefined)

    const shutdown = await proc.shutdown()
    expect(shutdown.code).toBe(0)
  }, 60_000)

  it('fails closed when Mail is unconfigured in production', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin-prod.db')
    const port = await getFreePort()

    const proc: NavindProcess = await startNavind({
      port,
      env: {
        NAVIN_DATABASE_PATH: databasePath,
        NAVIN_ENVIRONMENT: 'production',
        NAVIN_LOG_LEVEL: 'warn',
        NAVIN_SESSION_SECRET: 'production-session-secret-that-is-strong',
        NAVIN_ENCRYPTION_KEY: 'production-encryption-key-that-is-strong',
      },
    })
    cleanups.push(() => proc.kill())
    cleanups.push(() => removeTempDir(dir))

    const base = `http://127.0.0.1:${port}`

    const session = await fetch(`${base}/api/v1/mail/session`, { headers: mailHeaders() })
    expect(session.status).toBe(503)
    expect(((await session.json()) as { error: { code: string } }).error.code).toBe(
      'SERVICE_UNAVAILABLE',
    )

    const login = await fetch(`${base}/api/v1/mail/auth/login`, {
      method: 'POST',
      headers: mailHeaders(),
      body: JSON.stringify({ email: MAIL_EMAIL, password: MAIL_PASSWORD }),
    })
    expect(login.status).toBe(503)

    // Control endpoints remain available: only Mail fails closed.
    const health = await fetch(`${base}/health`)
    expect(health.status).toBe(200)

    const shutdown = await proc.shutdown()
    expect(shutdown.code).toBe(0)
  }, 60_000)

  it('rejects a spoofed sender identity or From address before contacting upstream', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin-mail-sender.db')
    const upstream = await startJmapUpstream()
    const port = await getFreePort()

    const proc = await startNavind({
      port,
      env: {
        NAVIN_DATABASE_PATH: databasePath,
        NAVIN_ENVIRONMENT: 'test',
        NAVIN_LOG_LEVEL: 'warn',
        NAVIN_MAIL_JMAP_SESSION_URL: upstream.sessionUrl,
        NAVIN_MAIL_JMAP_AUTHORIZATION: upstream.authorization,
        NAVIN_MAIL_ACCOUNT_EMAIL: MAIL_EMAIL,
        NAVIN_MAIL_SENDER_IDENTITY_ID: encodeId('als', 'id1'),
        NAVIN_MAIL_BOOTSTRAP_EMAIL: MAIL_EMAIL,
        NAVIN_MAIL_BOOTSTRAP_PASSWORD: MAIL_PASSWORD,
      },
    })
    cleanups.push(() => proc.kill())
    cleanups.push(() => upstream.stop())
    cleanups.push(() => removeTempDir(dir))

    const base = `http://127.0.0.1:${port}`

    const loginRes = await fetch(`${base}/api/v1/mail/auth/login`, {
      method: 'POST',
      headers: mailHeaders(),
      body: JSON.stringify({ email: MAIL_EMAIL, password: MAIL_PASSWORD }),
    })
    const { token } = (await loginRes.json()) as { token: string }

    const engineRes = await fetch(`${base}/api/v1/mail/session`, { headers: mailHeaders(token) })
    const engine = (await engineRes.json()) as MailSessionInfo
    const accountId = engine.primaryAccountId as string
    const configuredIdentity = encodeId('als', 'id1')

    const baseline = upstream.submissionCount()
    expect(baseline).toBe(0)

    const submissionBody = (overrides: Record<string, unknown>): Record<string, unknown> => ({
      accountId,
      idempotencyKey: 'idmp_sender_test_1',
      senderIdentityId: configuredIdentity,
      from: { name: 'Example User', address: MAIL_EMAIL },
      to: [{ address: 'bob@example.org' }],
      subject: 'Sender authority',
      bodyText: 'body',
      ...overrides,
    })
    const post = (body: Record<string, unknown>) =>
      fetch(`${base}/api/v1/mail/submissions`, {
        method: 'POST',
        headers: mailHeaders(token),
        body: JSON.stringify(body),
      })

    // A different identity is rejected without any upstream call.
    const spoofedIdentity = await post(
      submissionBody({
        idempotencyKey: 'idmp_spoof_identity',
        senderIdentityId: encodeId('als', 'someone-else'),
      }),
    )
    expect(spoofedIdentity.status).toBe(403)
    expect(((await spoofedIdentity.json()) as { error: { code: string } }).error.code).toBe(
      'FORBIDDEN',
    )
    expect(upstream.submissionCount()).toBe(baseline)

    // A different From address is rejected even with the correct identity.
    const spoofedFrom = await post(
      submissionBody({
        idempotencyKey: 'idmp_spoof_from',
        from: { name: 'Example User', address: 'attacker@example.org' },
      }),
    )
    expect(spoofedFrom.status).toBe(403)
    expect(upstream.submissionCount()).toBe(baseline)

    // The configured address is accepted case-insensitively; the display name
    // is not part of the address authority.
    const accepted = await post(
      submissionBody({
        idempotencyKey: 'idmp_sender_ok',
        from: { name: 'Renamed Display', address: MAIL_EMAIL.toUpperCase() },
      }),
    )
    expect(accepted.status).toBe(200)
    expect(upstream.submissionCount()).toBe(baseline + 1)

    const shutdown = await proc.shutdown()
    expect(shutdown.code).toBe(0)
  }, 60_000)
})
