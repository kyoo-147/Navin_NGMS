import { readFileSync, readdirSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StalwartFixtureServer } from '@navin/engine-core/testing'
import { getFreePort, startNavind } from './support/spawn-server.js'
import { createTempDir, removeTempDir } from './support/test-helpers.js'

const ENGINE_TOKEN = 'navin-engine-mailbox-process-token'
const ADMIN_EMAIL = 'admin@example.com'
const ADMIN_PASSWORD = 'correct-horse-battery-staple-1234'
const DOMAIN = 'example.com'
const MAILBOX_EMAIL = 'alice@example.com'
const MAILBOX_PASSWORD = 'mailbox-secret-9f3c1a7e'
const KEY = 'org-mailbox-process-1'

interface MailboxActionViewBody {
  action: {
    id: string
    status: string
    riskTier: number
    parameters: Record<string, unknown>
    canRollback?: boolean
    diff?: { changes: { path: string }[] }
    verification?: { passed: boolean; actual?: unknown }
    error?: { code: string; details?: Record<string, unknown> }
  }
  attempts: { status: string }[]
  job?: { status: string; payload?: Record<string, unknown> }
  evidence: { status: string }[]
  error?: { code: string; message: string; details?: Record<string, unknown> }
}

interface RecordedResponse {
  status: number
  body: unknown
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-navin-surface': 'cli' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { token: string }
  return body.token
}

function authHeaders(token: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-navin-surface': 'cli',
  }
}

function accountSetCreates(server: StalwartFixtureServer): number {
  return server.jmapCalls.filter(
    (call) =>
      call.method === 'x:Account/set' &&
      call.args.create !== null &&
      typeof call.args.create === 'object',
  ).length
}

function accountSetDestroys(server: StalwartFixtureServer): number {
  return server.jmapCalls.filter(
    (call) => call.method === 'x:Account/set' && Array.isArray(call.args.destroy),
  ).length
}

function jmapCallsContaining(server: StalwartFixtureServer, secret: string): number {
  return server.jmapCalls.filter((call) => JSON.stringify(call.args).includes(secret)).length
}

function readAllBytes(dir: string): string {
  const chunks: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      chunks.push(readAllBytes(path))
    } else if (entry.isFile()) {
      chunks.push(readFileSync(path).toString('utf8'))
    }
  }
  return chunks.join('\n')
}

interface EngineProxy {
  url: string
  /** Resolves once the fixture has committed an Account create. */
  created: Promise<void>
  release(): void
  stop(): Promise<void>
}

function isAccountCreateBody(bodyText: string): boolean {
  try {
    const parsed = JSON.parse(bodyText) as { methodCalls?: unknown }
    const calls = Array.isArray(parsed.methodCalls) ? parsed.methodCalls : []
    const call = calls[0]
    if (!Array.isArray(call) || call.length < 2 || call[0] !== 'x:Account/set') return false
    const args = call[1]
    return (
      typeof args === 'object' &&
      args !== null &&
      typeof (args as Record<string, unknown>).create === 'object' &&
      (args as Record<string, unknown>).create !== null
    )
  } catch {
    return false
  }
}

/**
 * A test-local HTTP boundary in front of the Stalwart fixture. It forwards every
 * request verbatim to the fixture, but once the fixture has committed an Account
 * create it withholds the response so a caller can kill the daemon exactly in the
 * crash window (side effect committed, completion not recorded). No engine-core
 * change is needed.
 */
async function startEngineProxy(targetBaseUrl: string): Promise<EngineProxy> {
  let resolveCreated!: () => void
  const created = new Promise<void>((resolve) => {
    resolveCreated = resolve
  })
  let held: (() => void) | undefined
  const release = (): void => {
    held?.()
    held = undefined
  }

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.on('error', () => undefined)
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const bodyText = Buffer.concat(chunks).toString('utf8')
      const method = req.method ?? 'GET'
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined || key === 'host' || key === 'content-length') continue
        headers[key] = Array.isArray(value) ? value.join(', ') : value
      }
      const upstream = await fetch(`${targetBaseUrl}${req.url ?? '/'}`, {
        method,
        headers,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: bodyText }),
        redirect: 'manual',
      })
      const text = await upstream.text()
      if (method === 'POST' && (req.url ?? '') === '/api' && isAccountCreateBody(bodyText)) {
        resolveCreated()
        // Hold the committed create's response until the caller has killed the
        // daemon; the eventual write is expected to fail on a dead socket.
        await new Promise<void>((resolve) => {
          held = resolve
        })
      }
      if (res.writableEnded) return
      res.statusCode = upstream.status
      upstream.headers.forEach((value, key) => {
        if (key !== 'content-length') res.setHeader(key, value)
      })
      res.end(text)
    })().catch(() => {
      if (!res.writableEnded) {
        res.statusCode = 500
        res.end()
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    created,
    release,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        release()
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
  responses: RecordedResponse[],
): Promise<{ status: number; body: MailboxActionViewBody }> {
  const response = await fetch(url, init)
  const body = (await response.json()) as MailboxActionViewBody
  responses.push({ status: response.status, body })
  return { status: response.status, body }
}

async function stepUp(baseUrl: string, token: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/step-up`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  })
  expect(response.status).toBe(200)
  return ((await response.json()) as { token: string }).token
}

/**
 * These tests run a real `navind` child process against a temporary SQLite
 * database and a local HTTP engine boundary (`StalwartFixtureServer`).
 *
 * The fixture is NOT a real Stalwart Docker deployment, production mail server
 * or mailbox-login authority: it speaks the admin JMAP shape the adapter calls
 * and records the requests, and it proves the control-plane behavior and the
 * secret-handling boundary, not that a mailbox can authenticate over IMAP/SMTP.
 */
describe('navind organization mailbox provisioning (real process)', () => {
  it('creates, restarts, resumes idempotently and destructively rolls back behind a Tier-3 typed-confirmation gate', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [{ id: 'd1', name: DOMAIN }],
      accounts: [],
      aliases: [],
    })
    await server.start()

    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      NAVIN_ENGINE_ENDPOINT: server.url,
      NAVIN_ENGINE_TOKEN: ENGINE_TOKEN,
      NAVIN_LOG_LEVEL: 'warn',
    }

    const responses: RecordedResponse[] = []
    let first: Awaited<ReturnType<typeof startNavind>> | undefined
    let second: Awaited<ReturnType<typeof startNavind>> | undefined

    try {
      const port1 = await getFreePort()
      first = await startNavind({ port: port1, env })
      const base1 = `http://127.0.0.1:${port1}`

      // Unauthenticated refusal: rejected before any engine work.
      const refused = await fetch(`${base1}/api/v1/control/organization/mailboxes/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-navin-surface': 'cli' },
        body: JSON.stringify({ email: MAILBOX_EMAIL }),
      })
      expect(refused.status).toBe(401)

      const headers1 = authHeaders(await login(base1))

      // plan: exact diff, no engine mutation.
      const planned = await requestJson(
        `${base1}/api/v1/control/organization/mailboxes/plan`,
        {
          method: 'POST',
          headers: headers1,
          body: JSON.stringify({ email: MAILBOX_EMAIL, description: 'Alice', idempotencyKey: KEY }),
        },
        responses,
      )
      expect(planned.status).toBe(200)
      expect(planned.body.action.status).toBe('planned')
      expect(planned.body.action.diff?.changes.map((change) => change.path)).toEqual(
        expect.arrayContaining(['name', 'domainId', 'description']),
      )
      const actionId = planned.body.action.id
      expect(server.getAccounts()).toHaveLength(0)
      expect(accountSetCreates(server)).toBe(0)

      // No password: fail closed with a typed secret-required error, zero mutation.
      const secretless = await requestJson(
        `${base1}/api/v1/control/organization/mailboxes`,
        {
          method: 'POST',
          headers: headers1,
          body: JSON.stringify({
            email: MAILBOX_EMAIL,
            description: 'Alice',
            confirm: true,
            idempotencyKey: KEY,
          }),
        },
        responses,
      )
      expect(secretless.status).toBe(409)
      expect(secretless.body.error?.code).toBe('ACTION_BLOCKED')
      expect(secretless.body.error?.details?.secretRequired).toBe(true)
      expect(accountSetCreates(server)).toBe(0)
      expect(server.getAccounts()).toHaveLength(0)

      // Same key with the password resumes and creates exactly once.
      const created = await requestJson(
        `${base1}/api/v1/control/organization/mailboxes`,
        {
          method: 'POST',
          headers: headers1,
          body: JSON.stringify({
            email: MAILBOX_EMAIL,
            description: 'Alice',
            password: MAILBOX_PASSWORD,
            confirm: true,
            idempotencyKey: KEY,
          }),
        },
        responses,
      )
      expect(created.status).toBe(200)
      expect(created.body.action.id).toBe(actionId)
      expect(created.body.action.status).toBe('completed')
      expect(created.body.action.verification?.passed).toBe(true)
      expect(created.body.job?.status).toBe('completed')
      expect(created.body.evidence.some((record) => record.status === 'passed')).toBe(true)
      expect(server.getAccounts().filter((account) => account.name === 'alice')).toHaveLength(1)
      expect(accountSetCreates(server)).toBe(1)

      // The password reaches the engine only on the Account create payload.
      expect(jmapCallsContaining(server, MAILBOX_PASSWORD)).toBe(1)
      const accountSetCall = server.jmapCalls.find((call) => call.method === 'x:Account/set')
      expect(JSON.stringify(accountSetCall?.args)).toContain(MAILBOX_PASSWORD)

      const status = await requestJson(
        `${base1}/api/v1/control/organization/mailboxes/actions/${actionId}`,
        { headers: headers1 },
        responses,
      )
      expect(status.status).toBe(200)
      expect(status.body.action.status).toBe('completed')

      // No serialized API response ever contains the password.
      for (const response of responses) {
        expect(JSON.stringify(response.body)).not.toContain(MAILBOX_PASSWORD)
      }

      expect((await first.shutdown()).code).toBe(0)
      first = undefined

      // ---- Second process on the same SQLite database ----
      const port2 = await getFreePort()
      second = await startNavind({ port: port2, env })
      const base2 = `http://127.0.0.1:${port2}`
      const headers2 = authHeaders(await login(base2))

      const recovered = await requestJson(
        `${base2}/api/v1/control/organization/mailboxes/actions/${actionId}`,
        { headers: headers2 },
        responses,
      )
      expect(recovered.body.action.id).toBe(actionId)
      expect(recovered.body.action.status).toBe('completed')

      // Idempotent resume: same key, same action, no duplicate side effect.
      const resumed = await requestJson(
        `${base2}/api/v1/control/organization/mailboxes`,
        {
          method: 'POST',
          headers: headers2,
          body: JSON.stringify({
            email: MAILBOX_EMAIL,
            description: 'Alice',
            password: MAILBOX_PASSWORD,
            confirm: true,
            idempotencyKey: KEY,
          }),
        },
        responses,
      )
      expect(resumed.status).toBe(200)
      expect(resumed.body.action.id).toBe(actionId)
      expect(accountSetCreates(server)).toBe(1)
      expect(server.getAccounts().filter((account) => account.name === 'alice')).toHaveLength(1)

      // Destructive rollback requires recent step-up even with the address.
      const noStepUp = await requestJson(
        `${base2}/api/v1/control/organization/mailboxes/actions/${actionId}/rollback`,
        {
          method: 'POST',
          headers: headers2,
          body: JSON.stringify({ confirmation: MAILBOX_EMAIL }),
        },
        responses,
      )
      expect(noStepUp.status).toBe(403)
      expect(noStepUp.body.error?.code).toBe('RISK_STEP_UP_REQUIRED')
      expect(server.getAccounts()).toHaveLength(1)

      const steppedToken = await stepUp(base2, (await login(base2)) as string)
      const steppedHeaders = authHeaders(steppedToken)

      // Wrong typed confirmation is refused; nothing is destroyed.
      const wrong = await requestJson(
        `${base2}/api/v1/control/organization/mailboxes/actions/${actionId}/rollback`,
        {
          method: 'POST',
          headers: steppedHeaders,
          body: JSON.stringify({ confirmation: 'other@example.com' }),
        },
        responses,
      )
      expect(wrong.status).toBe(403)
      expect(wrong.body.error?.code).toBe('APPROVAL_REQUIRED')
      expect(server.getAccounts()).toHaveLength(1)
      expect(accountSetDestroys(server)).toBe(0)

      // Exact typed confirmation plus step-up destroys and proves absence.
      const rolled = await requestJson(
        `${base2}/api/v1/control/organization/mailboxes/actions/${actionId}/rollback`,
        {
          method: 'POST',
          headers: steppedHeaders,
          body: JSON.stringify({ confirmation: MAILBOX_EMAIL }),
        },
        responses,
      )
      expect(rolled.status).toBe(200)
      expect(rolled.body.action.status).toBe('rolled_back')
      expect(server.getAccounts()).toHaveLength(0)
      expect(accountSetDestroys(server)).toBe(1)

      expect((await second.shutdown()).code).toBe(0)
      second = undefined

      // Security regression: the password is absent from temp SQLite bytes and
      // from every serialized API response.
      expect(readAllBytes(dir)).not.toContain(MAILBOX_PASSWORD)
      expect(JSON.stringify(responses)).not.toContain(MAILBOX_PASSWORD)
    } finally {
      first?.kill()
      second?.kill()
      await server.stop()
      removeTempDir(dir)
    }
  }, 90_000)

  it('requires both apply and approve authority: an operator performs zero mutation', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [{ id: 'd1', name: DOMAIN }],
      accounts: [],
      aliases: [],
    })
    await server.start()

    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      NAVIN_CONTROL_BOOTSTRAP_ROLE: 'ops.operator',
      NAVIN_ENGINE_ENDPOINT: server.url,
      NAVIN_ENGINE_TOKEN: ENGINE_TOKEN,
      NAVIN_LOG_LEVEL: 'warn',
    }

    let proc: Awaited<ReturnType<typeof startNavind>> | undefined
    try {
      const port = await getFreePort()
      proc = await startNavind({ port, env })
      const baseUrl = `http://127.0.0.1:${port}`
      const headers = authHeaders(await login(baseUrl))

      const planResponse = await fetch(`${baseUrl}/api/v1/control/organization/mailboxes/plan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: MAILBOX_EMAIL }),
      })
      expect(planResponse.status).toBe(200)

      const createResponse = await fetch(`${baseUrl}/api/v1/control/organization/mailboxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: MAILBOX_EMAIL,
          password: MAILBOX_PASSWORD,
          confirm: true,
        }),
      })
      expect(createResponse.status).toBe(403)
      expect(((await createResponse.json()) as MailboxActionViewBody).error?.code).toBe('FORBIDDEN')

      expect(server.getAccounts()).toHaveLength(0)
      expect(server.jmapCalls.some((call) => call.method === 'x:Account/set')).toBe(false)

      expect((await proc.shutdown()).code).toBe(0)
      proc = undefined
    } finally {
      proc?.kill()
      await server.stop()
      removeTempDir(dir)
    }
  }, 60_000)

  it('fails closed with a typed SERVICE_UNAVAILABLE when the engine is unreachable', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      NAVIN_ENGINE_ENDPOINT: 'http://127.0.0.1:1',
      NAVIN_ENGINE_TOKEN: ENGINE_TOKEN,
      NAVIN_LOG_LEVEL: 'warn',
    }

    let proc: Awaited<ReturnType<typeof startNavind>> | undefined
    try {
      const port = await getFreePort()
      proc = await startNavind({ port, env })
      const baseUrl = `http://127.0.0.1:${port}`
      const headers = authHeaders(await login(baseUrl))

      const response = await fetch(`${baseUrl}/api/v1/control/organization/mailboxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: MAILBOX_EMAIL, password: MAILBOX_PASSWORD, confirm: true }),
      })
      expect(response.status).toBe(503)
      expect(((await response.json()) as MailboxActionViewBody).error?.code).toBe(
        'SERVICE_UNAVAILABLE',
      )

      expect((await proc.shutdown()).code).toBe(0)
      proc = undefined
    } finally {
      proc?.kill()
      removeTempDir(dir)
    }
  }, 60_000)

  it('refuses a conflicting pre-existing mailbox with zero mutation and an exact existing mailbox as a no-op', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [{ id: 'd1', name: DOMAIN }],
      accounts: [{ id: 'a1', name: 'bob', domainId: 'd1', description: 'legacy' }],
      aliases: [],
    })
    await server.start()

    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      NAVIN_ENGINE_ENDPOINT: server.url,
      NAVIN_ENGINE_TOKEN: ENGINE_TOKEN,
      NAVIN_LOG_LEVEL: 'warn',
    }

    let proc: Awaited<ReturnType<typeof startNavind>> | undefined
    try {
      const port = await getFreePort()
      proc = await startNavind({ port, env })
      const baseUrl = `http://127.0.0.1:${port}`
      const headers = authHeaders(await login(baseUrl))

      // Conflicting pre-existing mailbox: refused before any mutation.
      const conflict = await fetch(`${baseUrl}/api/v1/control/organization/mailboxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: 'bob@example.com',
          description: 'new',
          password: MAILBOX_PASSWORD,
          confirm: true,
        }),
      })
      expect(conflict.status).toBe(409)
      expect(((await conflict.json()) as MailboxActionViewBody).error?.code).toBe(
        'PRECONDITION_FAILED',
      )
      expect(server.getAccounts()[0]?.description).toBe('legacy')
      expect(server.jmapCalls.some((call) => call.method === 'x:Account/set')).toBe(false)

      // Exact existing mailbox: valid no-op with no rollback ownership.
      const noop = await fetch(`${baseUrl}/api/v1/control/organization/mailboxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: 'bob@example.com',
          description: 'legacy',
          password: MAILBOX_PASSWORD,
          confirm: true,
          idempotencyKey: 'org-mailbox-noop-1',
        }),
      })
      expect(noop.status).toBe(200)
      const noopBody = (await noop.json()) as MailboxActionViewBody
      expect(noopBody.action.status).toBe('completed')
      expect(noopBody.action.canRollback).toBe(false)
      expect(server.jmapCalls.some((call) => call.method === 'x:Account/set')).toBe(false)
      expect(JSON.stringify(noopBody)).not.toContain(MAILBOX_PASSWORD)

      const steppedToken = await stepUp(baseUrl, await login(baseUrl))
      const rollback = await fetch(
        `${baseUrl}/api/v1/control/organization/mailboxes/actions/${noopBody.action.id}/rollback`,
        {
          method: 'POST',
          headers: authHeaders(steppedToken),
          body: JSON.stringify({ confirmation: 'bob@example.com' }),
        },
      )
      expect(rollback.status).toBe(409)
      expect(((await rollback.json()) as MailboxActionViewBody).error?.code).toBe('ACTION_BLOCKED')
      expect(server.getAccounts()).toHaveLength(1)

      expect((await proc.shutdown()).code).toBe(0)
      proc = undefined
    } finally {
      proc?.kill()
      await server.stop()
      removeTempDir(dir)
    }
  }, 60_000)

  it('refuses to destroy a mailbox that is an alias destination', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [{ id: 'd1', name: DOMAIN }],
      accounts: [],
      aliases: [{ id: 'al1', name: 'sales', domainId: 'd1', target: MAILBOX_EMAIL, enabled: true }],
    })
    await server.start()

    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      NAVIN_ENGINE_ENDPOINT: server.url,
      NAVIN_ENGINE_TOKEN: ENGINE_TOKEN,
      NAVIN_LOG_LEVEL: 'warn',
    }

    let proc: Awaited<ReturnType<typeof startNavind>> | undefined
    try {
      const port = await getFreePort()
      proc = await startNavind({ port, env })
      const baseUrl = `http://127.0.0.1:${port}`
      const headers = authHeaders(await login(baseUrl))

      const created = await fetch(`${baseUrl}/api/v1/control/organization/mailboxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: MAILBOX_EMAIL, password: MAILBOX_PASSWORD, confirm: true }),
      })
      expect(created.status).toBe(200)
      const actionId = ((await created.json()) as MailboxActionViewBody).action.id

      const steppedToken = await stepUp(baseUrl, await login(baseUrl))
      const rollback = await fetch(
        `${baseUrl}/api/v1/control/organization/mailboxes/actions/${actionId}/rollback`,
        {
          method: 'POST',
          headers: authHeaders(steppedToken),
          body: JSON.stringify({ confirmation: MAILBOX_EMAIL }),
        },
      )
      expect(rollback.status).toBe(409)
      const body = (await rollback.json()) as MailboxActionViewBody
      expect(body.error?.code).toBe('ACTION_BLOCKED')
      expect(body.error?.details?.needsAttention).toBe(true)
      expect(server.getAccounts()).toHaveLength(1)
      expect(accountSetDestroys(server)).toBe(0)

      expect((await proc.shutdown()).code).toBe(0)
      proc = undefined
    } finally {
      proc?.kill()
      await server.stop()
      removeTempDir(dir)
    }
  }, 60_000)

  it('fails closed as needsAttention when dependency discovery is fail-soft with warnings', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [{ id: 'd1', name: DOMAIN }],
      accounts: [],
      aliases: [],
    })
    await server.start()

    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      NAVIN_ENGINE_ENDPOINT: server.url,
      NAVIN_ENGINE_TOKEN: ENGINE_TOKEN,
      NAVIN_LOG_LEVEL: 'warn',
    }

    let proc: Awaited<ReturnType<typeof startNavind>> | undefined
    try {
      const port = await getFreePort()
      proc = await startNavind({ port, env })
      const baseUrl = `http://127.0.0.1:${port}`
      const headers = authHeaders(await login(baseUrl))

      const created = await fetch(`${baseUrl}/api/v1/control/organization/mailboxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: MAILBOX_EMAIL, password: MAILBOX_PASSWORD, confirm: true }),
      })
      expect(created.status).toBe(200)
      const actionId = ((await created.json()) as MailboxActionViewBody).action.id

      // Discovery cannot enumerate aliases, so it is never a licence to destroy.
      const warningText = 'discovery of aliases failed: http://127.0.0.1:1234 admin'
      server.failNextMethod('x:Alias/query', { type: 'serverFail', description: warningText })

      const steppedToken = await stepUp(baseUrl, await login(baseUrl))
      const rollback = await fetch(
        `${baseUrl}/api/v1/control/organization/mailboxes/actions/${actionId}/rollback`,
        {
          method: 'POST',
          headers: authHeaders(steppedToken),
          body: JSON.stringify({ confirmation: MAILBOX_EMAIL }),
        },
      )
      expect(rollback.status).toBe(409)
      const raw = await rollback.text()
      expect(raw).not.toContain('127.0.0.1')
      expect(raw).not.toContain('discovery of aliases failed')
      expect(server.getAccounts()).toHaveLength(1)
      expect(accountSetDestroys(server)).toBe(0)

      expect((await proc.shutdown()).code).toBe(0)
      proc = undefined
    } finally {
      proc?.kill()
      await server.stop()
      removeTempDir(dir)
    }
  }, 60_000)

  it('rejects a password on the plan route with a typed validation error and zero mutation', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [{ id: 'd1', name: DOMAIN }],
      accounts: [],
      aliases: [],
    })
    await server.start()

    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      NAVIN_ENGINE_ENDPOINT: server.url,
      NAVIN_ENGINE_TOKEN: ENGINE_TOKEN,
      NAVIN_LOG_LEVEL: 'warn',
    }

    let proc: Awaited<ReturnType<typeof startNavind>> | undefined
    try {
      const port = await getFreePort()
      proc = await startNavind({ port, env })
      const baseUrl = `http://127.0.0.1:${port}`
      const headers = authHeaders(await login(baseUrl))

      const response = await fetch(`${baseUrl}/api/v1/control/organization/mailboxes/plan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: MAILBOX_EMAIL, password: MAILBOX_PASSWORD }),
      })
      expect(response.status).toBe(422)
      const raw = await response.text()
      expect((JSON.parse(raw) as MailboxActionViewBody).error?.code).toBe('VALIDATION_FAILED')
      // The rejected secret is never echoed back.
      expect(raw).not.toContain(MAILBOX_PASSWORD)
      expect(server.jmapCalls.some((call) => call.method === 'x:Account/set')).toBe(false)
      expect(server.getAccounts()).toHaveLength(0)

      expect((await proc.shutdown()).code).toBe(0)
      proc = undefined
    } finally {
      proc?.kill()
      await server.stop()
      removeTempDir(dir)
    }
  }, 60_000)

  it('recovers from a crash window after the engine committed the create and reconciles on resubmit with exactly one mailbox', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [{ id: 'd1', name: DOMAIN }],
      accounts: [],
      aliases: [],
    })
    await server.start()
    const proxy = await startEngineProxy(server.url)

    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      NAVIN_ENGINE_ENDPOINT: proxy.url,
      NAVIN_ENGINE_TOKEN: ENGINE_TOKEN,
      NAVIN_LOG_LEVEL: 'warn',
    }

    let first: Awaited<ReturnType<typeof startNavind>> | undefined
    let second: Awaited<ReturnType<typeof startNavind>> | undefined
    try {
      const port1 = await getFreePort()
      first = await startNavind({ port: port1, env })
      const base1 = `http://127.0.0.1:${port1}`
      const headers1 = authHeaders(await login(base1))

      const planResponse = await fetch(`${base1}/api/v1/control/organization/mailboxes/plan`, {
        method: 'POST',
        headers: headers1,
        body: JSON.stringify({ email: MAILBOX_EMAIL, idempotencyKey: KEY }),
      })
      expect(planResponse.status).toBe(200)
      const actionId = ((await planResponse.json()) as MailboxActionViewBody).action.id

      // The proxy withholds the Account/set response once the fixture commits.
      const createPromise = fetch(`${base1}/api/v1/control/organization/mailboxes`, {
        method: 'POST',
        headers: headers1,
        body: JSON.stringify({
          email: MAILBOX_EMAIL,
          password: MAILBOX_PASSWORD,
          confirm: true,
          idempotencyKey: KEY,
        }),
      })
      await proxy.created

      // The engine holds the mailbox, but navind never recorded completion.
      expect(server.getAccounts().filter((account) => account.name === 'alice')).toHaveLength(1)
      expect(accountSetCreates(server)).toBe(1)

      first.kill()
      await createPromise.catch(() => undefined)
      first = undefined

      // Restart on the same SQLite: the interrupted dispatch is truthful.
      const port2 = await getFreePort()
      second = await startNavind({ port: port2, env })
      const base2 = `http://127.0.0.1:${port2}`
      const headers2 = authHeaders(await login(base2))

      const statusResponse = await fetch(
        `${base2}/api/v1/control/organization/mailboxes/actions/${actionId}`,
        { headers: headers2 },
      )
      expect(statusResponse.status).toBe(200)
      const statusBody = (await statusResponse.json()) as MailboxActionViewBody
      expect(statusBody.action.status).toBe('failed')
      expect(statusBody.action.error?.details?.needsAttention).toBe(true)
      expect(JSON.stringify(statusBody)).not.toContain(MAILBOX_PASSWORD)

      // The same request and key reconcile the unknown outcome without a second
      // create and end with observed verification and evidence.
      const resumeResponse = await fetch(`${base2}/api/v1/control/organization/mailboxes`, {
        method: 'POST',
        headers: headers2,
        body: JSON.stringify({
          email: MAILBOX_EMAIL,
          password: MAILBOX_PASSWORD,
          confirm: true,
          idempotencyKey: KEY,
        }),
      })
      expect(resumeResponse.status).toBe(200)
      const resumed = (await resumeResponse.json()) as MailboxActionViewBody
      expect(resumed.action.id).toBe(actionId)
      expect(resumed.action.status).toBe('completed')
      expect(resumed.action.verification?.passed).toBe(true)
      expect(resumed.evidence.some((record) => record.status === 'passed')).toBe(true)
      expect(accountSetCreates(server)).toBe(1)
      expect(server.getAccounts().filter((account) => account.name === 'alice')).toHaveLength(1)

      // Exactly one Account create ever reached the engine; no secret leaked.
      expect(jmapCallsContaining(server, MAILBOX_PASSWORD)).toBe(1)
      expect(JSON.stringify(resumed)).not.toContain(MAILBOX_PASSWORD)
      expect(readAllBytes(dir)).not.toContain(MAILBOX_PASSWORD)

      expect((await second.shutdown()).code).toBe(0)
      second = undefined
    } finally {
      first?.kill()
      second?.kill()
      await proxy.stop()
      await server.stop()
      removeTempDir(dir)
    }
  }, 90_000)
})
