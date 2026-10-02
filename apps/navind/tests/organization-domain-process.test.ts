import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StalwartFixtureServer } from '@navin/engine-core/testing'
import { getFreePort, startNavind } from './support/spawn-server.js'
import { createTempDir, removeTempDir } from './support/test-helpers.js'

const ENGINE_TOKEN = 'navin-engine-domain-process-token'
const ADMIN_EMAIL = 'alice@example.com'
const ADMIN_PASSWORD = 'correct-horse-battery-staple-1234'
const DOMAIN = 'company.test'

interface DomainActionViewBody {
  action: {
    id: string
    status: string
    parameters: Record<string, unknown>
    diff?: { changes: { path: string }[] }
    verification?: { passed: boolean }
    error?: { code: string; details?: Record<string, unknown> }
  }
  attempts: { status: string }[]
  job?: { status: string }
  evidence: { status: string }[]
  error?: { code: string; message: string }
}

async function login(baseUrl: string, email = ADMIN_EMAIL): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-navin-surface': 'cli' },
    body: JSON.stringify({ email, password: ADMIN_PASSWORD }),
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

function domainSetCreates(server: StalwartFixtureServer): number {
  return server.jmapCalls.filter(
    (call) =>
      call.method === 'x:Domain/set' &&
      call.args.create !== null &&
      typeof call.args.create === 'object',
  ).length
}

function aliasSetMutations(server: StalwartFixtureServer): number {
  return server.jmapCalls.filter((call) => call.method === 'x:Alias/set').length
}

describe('navind organization domain provisioning (real process)', () => {
  it('runs the full domain lifecycle against a real HTTP engine boundary, survives restart, resumes idempotently and rolls back', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [],
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

    let first: Awaited<ReturnType<typeof startNavind>> | undefined
    let second: Awaited<ReturnType<typeof startNavind>> | undefined

    try {
      // ---- First process ----
      const port1 = await getFreePort()
      first = await startNavind({ port: port1, env })
      const base1 = `http://127.0.0.1:${port1}`

      // Auth refusal: no bearer token is rejected before any work.
      const refused = await fetch(`${base1}/api/v1/control/organization/domains/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-navin-surface': 'cli' },
        body: JSON.stringify({ name: DOMAIN }),
      })
      expect(refused.status).toBe(401)

      const headers1 = authHeaders(await login(base1))

      // discover + plan: exact diff, no engine mutation.
      const planResponse = await fetch(`${base1}/api/v1/control/organization/domains/plan`, {
        method: 'POST',
        headers: headers1,
        body: JSON.stringify({
          name: DOMAIN,
          description: 'Primary domain',
          idempotencyKey: 'org-domain-process-1',
        }),
      })
      expect(planResponse.status).toBe(200)
      const planned = (await planResponse.json()) as DomainActionViewBody
      expect(planned.action.status).toBe('planned')
      expect(planned.action.diff?.changes.map((change) => change.path)).toEqual(
        expect.arrayContaining(['name', 'description']),
      )
      const actionId = planned.action.id
      expect(server.getDomains()).toHaveLength(0)
      expect(domainSetCreates(server)).toBe(0)

      // Non-interactive fail closed: no confirmation, no mutation, typed error.
      const unconfirmed = await fetch(`${base1}/api/v1/control/organization/domains`, {
        method: 'POST',
        headers: headers1,
        body: JSON.stringify({ name: DOMAIN, description: 'Primary domain' }),
      })
      expect(unconfirmed.status).toBe(403)
      expect(((await unconfirmed.json()) as DomainActionViewBody).error?.code).toBe(
        'APPROVAL_REQUIRED',
      )
      expect(server.getDomains()).toHaveLength(0)

      // approve + apply + verify + result.
      const createResponse = await fetch(`${base1}/api/v1/control/organization/domains`, {
        method: 'POST',
        headers: headers1,
        body: JSON.stringify({
          name: DOMAIN,
          description: 'Primary domain',
          confirm: true,
          idempotencyKey: 'org-domain-process-1',
        }),
      })
      expect(createResponse.status).toBe(200)
      const created = (await createResponse.json()) as DomainActionViewBody
      expect(created.action.id).toBe(actionId)
      expect(created.action.status).toBe('completed')
      expect(created.action.verification?.passed).toBe(true)
      expect(created.job?.status).toBe('completed')
      expect(created.evidence.some((record) => record.status === 'passed')).toBe(true)
      expect(server.getDomains().filter((domain) => domain.name === DOMAIN)).toHaveLength(1)
      expect(domainSetCreates(server)).toBe(1)

      const statusResponse = await fetch(
        `${base1}/api/v1/control/organization/domains/actions/${actionId}`,
        { headers: headers1 },
      )
      expect(statusResponse.status).toBe(200)
      const statusBody = (await statusResponse.json()) as DomainActionViewBody
      expect(statusBody.action.id).toBe(actionId)
      expect(statusBody.action.status).toBe('completed')

      expect((await first.shutdown()).code).toBe(0)
      first = undefined

      // ---- Second process on the same SQLite database ----
      const port2 = await getFreePort()
      second = await startNavind({ port: port2, env })
      const base2 = `http://127.0.0.1:${port2}`
      const headers2 = authHeaders(await login(base2))

      const recovered = (await (
        await fetch(`${base2}/api/v1/control/organization/domains/actions/${actionId}`, {
          headers: headers2,
        })
      ).json()) as DomainActionViewBody
      expect(recovered.action.id).toBe(actionId)
      expect(recovered.action.status).toBe('completed')

      // Idempotent resume: same key, same action, no duplicate side effect.
      const resumeResponse = await fetch(`${base2}/api/v1/control/organization/domains`, {
        method: 'POST',
        headers: headers2,
        body: JSON.stringify({
          name: DOMAIN,
          description: 'Primary domain',
          confirm: true,
          idempotencyKey: 'org-domain-process-1',
        }),
      })
      expect(resumeResponse.status).toBe(200)
      const resumed = (await resumeResponse.json()) as DomainActionViewBody
      expect(resumed.action.id).toBe(actionId)
      expect(server.getDomains().filter((domain) => domain.name === DOMAIN)).toHaveLength(1)
      expect(domainSetCreates(server)).toBe(1)

      // rollback: removes exactly the created domain and verifies absence.
      const rollbackResponse = await fetch(
        `${base2}/api/v1/control/organization/domains/actions/${actionId}/rollback`,
        { method: 'POST', headers: headers2, body: JSON.stringify({}) },
      )
      expect(rollbackResponse.status).toBe(200)
      const rolledBack = (await rollbackResponse.json()) as DomainActionViewBody
      expect(rolledBack.action.status).toBe('rolled_back')
      expect(server.getDomains()).toHaveLength(0)

      expect((await second.shutdown()).code).toBe(0)
      second = undefined
    } finally {
      first?.kill()
      second?.kill()
      await server.stop()
      removeTempDir(dir)
    }
  }, 60_000)

  it('fails closed with a typed SERVICE_UNAVAILABLE when the engine is unreachable and creates no domain', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      // Loopback address with no listener: configured but unreachable.
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

      const response = await fetch(`${baseUrl}/api/v1/control/organization/domains`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: DOMAIN, confirm: true }),
      })
      expect(response.status).toBe(503)
      const body = (await response.json()) as DomainActionViewBody
      expect(body.error?.code).toBe('SERVICE_UNAVAILABLE')

      expect((await proc.shutdown()).code).toBe(0)
      proc = undefined
    } finally {
      proc?.kill()
      removeTempDir(dir)
    }
  }, 60_000)

  it('requires both apply and approve authority: an operator holds apply but not approve and performs zero mutation', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [],
      accounts: [],
      aliases: [],
    })
    await server.start()

    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: 'operator@example.com',
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      // Least privilege: control:apply (and plan) but no control:approve.
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
      const headers = authHeaders(await login(baseUrl, 'operator@example.com'))

      // Planning is plan-scoped and remains allowed for the operator.
      const planResponse = await fetch(`${baseUrl}/api/v1/control/organization/domains/plan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: DOMAIN }),
      })
      expect(planResponse.status).toBe(200)

      // A confirmed apply requires apply + approve; the operator is refused.
      const createResponse = await fetch(`${baseUrl}/api/v1/control/organization/domains`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: DOMAIN, confirm: true }),
      })
      expect(createResponse.status).toBe(403)
      const body = (await createResponse.json()) as DomainActionViewBody
      expect(body.error?.code).toBe('FORBIDDEN')

      // No upstream mutation occurred: no domain and no Domain/set call.
      expect(server.getDomains()).toHaveLength(0)
      expect(server.jmapCalls.some((call) => call.method === 'x:Domain/set')).toBe(false)

      expect((await proc.shutdown()).code).toBe(0)
      proc = undefined
    } finally {
      proc?.kill()
      await server.stop()
      removeTempDir(dir)
    }
  }, 60_000)

  it('refuses a conflicting pre-existing domain with a typed failure and zero mutation', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [{ id: 'd1', name: DOMAIN, description: 'legacy' }],
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

      const response = await fetch(`${baseUrl}/api/v1/control/organization/domains`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: DOMAIN, description: 'new', confirm: true }),
      })
      expect(response.status).toBe(409)
      const body = (await response.json()) as DomainActionViewBody
      expect(body.error?.code).toBe('PRECONDITION_FAILED')

      // The pre-existing domain is untouched and no Domain/set was sent.
      expect(server.getDomains()).toHaveLength(1)
      expect(server.getDomains()[0]?.description).toBe('legacy')
      expect(server.jmapCalls.some((call) => call.method === 'x:Domain/set')).toBe(false)

      expect((await proc.shutdown()).code).toBe(0)
      proc = undefined
    } finally {
      proc?.kill()
      await server.stop()
      removeTempDir(dir)
    }
  }, 60_000)

  it('regression: refuses a conflicting pre-existing alias with zero Alias/set mutation', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const server = new StalwartFixtureServer({
      token: ENGINE_TOKEN,
      domains: [{ id: 'd1', name: 'example.com' }],
      accounts: [{ id: 'a1', name: 'alice', domainId: 'd1' }],
      aliases: [
        { id: 'al1', name: 'sales', domainId: 'd1', target: 'other@example.com', enabled: true },
      ],
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

      const response = await fetch(`${baseUrl}/api/v1/control/organization/aliases`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          address: 'sales@example.com',
          target: 'alice@example.com',
          confirm: true,
        }),
      })
      expect(response.status).toBe(409)
      expect(aliasSetMutations(server)).toBe(0)
      expect(server.getAliases()).toHaveLength(1)
      expect(server.getAliases()[0]?.target).toBe('other@example.com')

      expect((await proc.shutdown()).code).toBe(0)
      proc = undefined
    } finally {
      proc?.kill()
      await server.stop()
      removeTempDir(dir)
    }
  }, 60_000)
})
