import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { encodeId } from '@navin/mail-gateway'
import { MailApp, createMailClient } from '../src/index.js'
import { createTempDir, getFreePort, removeTempDir, startNavind } from './support/navind.js'
import { startJmapUpstream } from '../../navind/tests/support/jmap-fixture.js'

const MAIL_EMAIL = 'user@example.org'
const MAIL_PASSWORD = 'correct-horse-battery-staple-1234'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  cleanup()
  while (cleanups.length > 0) {
    const cleanupTask = cleanups.pop()
    if (!cleanupTask) continue
    try {
      await cleanupTask()
    } catch {
      // Cleanup is best-effort; a failure must not mask the test result.
    }
  }
})

/**
 * jsdom supplies its own AbortSignal, which Node's undici fetch rejects. The
 * client always attaches a linked abort signal, so strip it for the test
 * transport — request timeouts are not what these tests exercise.
 */
function domSafeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const realFetch = globalThis.fetch.bind(globalThis)
  if (!init || init.signal === undefined) return realFetch(input, init)
  const rest = { ...init }
  delete rest.signal
  return realFetch(input, rest)
}

function renderMailApp(baseUrl: string) {
  return render(
    <MailApp
      clientFactory={(getToken) => createMailClient({ baseUrl, getToken, fetch: domSafeFetch })}
    />,
  )
}

async function signIn(): Promise<void> {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: MAIL_EMAIL } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: MAIL_PASSWORD } })
  // Wait for the initial session probe to settle so the button is enabled.
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
}

async function startMailNavind(options: {
  databaseName: string
  senderIdentityId?: string
}): Promise<string> {
  const dir = createTempDir()
  const upstream = await startJmapUpstream()
  const port = await getFreePort()
  const proc = await startNavind({
    port,
    env: {
      NAVIN_DATABASE_PATH: join(dir, options.databaseName),
      NAVIN_ENVIRONMENT: 'test',
      NAVIN_LOG_LEVEL: 'warn',
      NAVIN_MAIL_JMAP_SESSION_URL: upstream.sessionUrl,
      NAVIN_MAIL_JMAP_AUTHORIZATION: upstream.authorization,
      NAVIN_MAIL_ACCOUNT_EMAIL: MAIL_EMAIL,
      NAVIN_MAIL_BOOTSTRAP_EMAIL: MAIL_EMAIL,
      NAVIN_MAIL_BOOTSTRAP_PASSWORD: MAIL_PASSWORD,
      ...(options.senderIdentityId
        ? { NAVIN_MAIL_SENDER_IDENTITY_ID: options.senderIdentityId }
        : {}),
    },
  })
  cleanups.push(() => proc.kill())
  cleanups.push(() => upstream.stop())
  cleanups.push(() => removeTempDir(dir))
  cleanups.push(() => proc.shutdown().then(() => undefined))
  return `http://127.0.0.1:${port}`
}

describe('Navin Mail Web over a real navind Mail BFF', () => {
  it('signs in, lists mailboxes and shows real inbox threads', async () => {
    const baseUrl = await startMailNavind({
      databaseName: 'navin-mail-web.db',
      senderIdentityId: encodeId('als', 'id1'),
    })

    renderMailApp(baseUrl)

    // Signed out: the login surface is shown.
    expect(await screen.findByTestId('mail-login')).toBeDefined()
    await signIn()

    // Signed in: the workspace renders the authenticated user and real inbox mail.
    expect(await screen.findByTestId('mail-workspace')).toBeDefined()
    expect((await screen.findByTestId('mail-current-user')).textContent).toBe(MAIL_EMAIL)
    expect(await screen.findByText('Welcome to Navin')).toBeDefined()
    expect(await screen.findByText('Invoice 42')).toBeDefined()
  }, 60_000)

  it('composes and submits through the BFF, and retries idempotently with the same key', async () => {
    const baseUrl = await startMailNavind({
      databaseName: 'navin-mail-web-compose.db',
      senderIdentityId: encodeId('als', 'id1'),
    })

    renderMailApp(baseUrl)
    await signIn()
    await screen.findByTestId('mail-workspace')

    // Sender is server-authoritative, not fabricated by the UI.
    expect((await screen.findByTestId('mail-sender-address')).textContent).toContain(MAIL_EMAIL)

    fireEvent.click(screen.getByRole('button', { name: 'Compose' }))
    await screen.findByTestId('mail-compose')
    expect(screen.queryByTestId('mail-compose-disabled')).toBeNull()
    expect((screen.getByTestId('mail-compose-from') as HTMLInputElement).value).toBe(MAIL_EMAIL)

    fireEvent.change(screen.getByTestId('mail-compose-to'), {
      target: { value: 'bob@example.org' },
    })
    fireEvent.change(screen.getByTestId('mail-compose-subject'), {
      target: { value: 'Hello from Navin Mail' },
    })
    fireEvent.change(screen.getByTestId('mail-compose-body'), {
      target: { value: 'Sent from the Mail web UI.' },
    })
    fireEvent.click(screen.getByTestId('mail-compose-send'))

    const firstSubmissionId = (await screen.findByTestId('mail-send-submission-id')).textContent
    expect(firstSubmissionId).toMatch(/^sub_/)
    expect(
      (await screen.findByTestId('mail-send-status')).textContent?.length ?? 0,
    ).toBeGreaterThan(0)
    expect(screen.getByTestId('mail-send-count').textContent).toBe('1')

    // Retrying with the same idempotency key must be deduplicated by the BFF:
    // the submission id is unchanged even though another POST occurred.
    fireEvent.click(await screen.findByTestId('mail-compose-resend'))
    await waitFor(() => {
      expect(screen.getByTestId('mail-send-count').textContent).toBe('2')
    })
    expect(screen.getByTestId('mail-send-submission-id').textContent).toBe(firstSubmissionId)
  }, 60_000)

  it('disables compose when no sender identity is configured', async () => {
    const baseUrl = await startMailNavind({ databaseName: 'navin-mail-web-nosender.db' })

    renderMailApp(baseUrl)
    await signIn()
    await screen.findByTestId('mail-workspace')
    // Wait for the engine session (and mailboxes) to load before asserting.
    await screen.findByText('Inbox')
    expect(screen.queryByTestId('mail-sender-address')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Compose' }))
    await screen.findByTestId('mail-compose')
    expect((await screen.findByTestId('mail-compose-disabled')).textContent).toMatch(
      /No sender identity/i,
    )
    expect((screen.getByTestId('mail-compose-send') as HTMLButtonElement).disabled).toBe(true)
  }, 60_000)

  it('surfaces the server fail-closed error when mail is unconfigured', async () => {
    const dir = createTempDir()
    const port = await getFreePort()
    const proc = await startNavind({
      port,
      env: {
        NAVIN_DATABASE_PATH: join(dir, 'navin-mail-web-unconfigured.db'),
        NAVIN_ENVIRONMENT: 'test',
        NAVIN_LOG_LEVEL: 'warn',
        NAVIN_MAIL_BOOTSTRAP_EMAIL: MAIL_EMAIL,
        NAVIN_MAIL_BOOTSTRAP_PASSWORD: MAIL_PASSWORD,
      },
    })
    cleanups.push(() => proc.kill())
    cleanups.push(() => removeTempDir(dir))
    cleanups.push(() => proc.shutdown().then(() => undefined))

    renderMailApp(`http://127.0.0.1:${port}`)

    expect(await screen.findByTestId('mail-login')).toBeDefined()
    await signIn()

    const alert = await screen.findByTestId('mail-login-error')
    expect(alert.textContent).toMatch(/SERVICE_UNAVAILABLE/)
    expect(screen.queryByTestId('mail-workspace')).toBeNull()
  }, 60_000)
})
