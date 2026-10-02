import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActionCore } from '@navin/action-core'
import { StalwartEngineAdapter } from '@navin/engine-core'
import { StalwartFixtureServer } from '@navin/engine-core/testing'
import { OrganizationService } from '../src/index.js'

const TOKEN = 'organization-core-domain-test-token'
const DOMAIN = 'example.com'

let dir: string
let databasePath: string
let core: ActionCore
let server: StalwartFixtureServer
let adapter: StalwartEngineAdapter
let service: OrganizationService

function newService(engine: StalwartEngineAdapter | null): OrganizationService {
  return new OrganizationService({ core, engine, clock: () => new Date() })
}

function domainSetCreates(): number {
  return server.jmapCalls.filter(
    (call) =>
      call.method === 'x:Domain/set' &&
      call.args.create !== null &&
      typeof call.args.create === 'object',
  ).length
}

function domainSetDestroys(): number {
  return server.jmapCalls.filter(
    (call) => call.method === 'x:Domain/set' && Array.isArray(call.args.destroy),
  ).length
}

async function startServer(domains: { id: string; name: string; description?: string }[]) {
  server = new StalwartFixtureServer({ token: TOKEN, domains, accounts: [], aliases: [] })
  await server.start()
  adapter = new StalwartEngineAdapter({
    endpoint: server.url,
    token: TOKEN,
    retry: { attempts: 1 },
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'organization-core-domain-'))
  databasePath = join(dir, 'actions.db')
  core = ActionCore.open({ path: databasePath, clock: () => new Date() })
})

afterEach(async () => {
  if (core.describe().open) core.close()
  if (server) await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('organization domain provisioning', () => {
  it('plans the exact domain change without touching the engine', async () => {
    await startServer([])
    service = newService(adapter)

    const view = await service.planDomain(
      { name: DOMAIN, description: 'Primary domain' },
      { requestedBy: 'usr_ops' },
    )

    expect(view.action.status).toBe('planned')
    expect(view.action.riskTier).toBe(1)
    expect(view.action.canRollback).toBe(true)
    const paths = view.action.diff?.changes.map((change) => change.path) ?? []
    expect(paths).toContain('name')
    expect(paths).toContain('description')
    expect(server.getDomains()).toHaveLength(0)
    expect(domainSetCreates()).toBe(0)
  })

  it('applies, verifies and records real evidence for a reversible create', async () => {
    await startServer([])
    service = newService(adapter)

    const view = await service.provisionDomain(
      { name: DOMAIN, description: 'Primary domain' },
      { requestedBy: 'usr_ops', confirm: true },
    )

    expect(view.action.status).toBe('completed')
    expect(view.action.verification?.passed).toBe(true)
    expect(view.job?.status).toBe('completed')
    expect(view.attempts.map((attempt) => attempt.status)).toContain('succeeded')
    expect(view.evidence.some((record) => record.status === 'passed')).toBe(true)
    expect(server.getDomains().some((domain) => domain.name === DOMAIN)).toBe(true)
    expect(domainSetCreates()).toBe(1)
  })

  it('is idempotent: a repeated call returns the same action and never duplicates the domain', async () => {
    await startServer([])
    service = newService(adapter)

    const first = await service.provisionDomain(
      { name: DOMAIN },
      { requestedBy: 'usr_ops', confirm: true },
    )
    const second = await service.provisionDomain(
      { name: DOMAIN },
      { requestedBy: 'usr_ops', confirm: true },
    )

    expect(second.action.id).toBe(first.action.id)
    expect(second.action.status).toBe('completed')
    expect(server.getDomains().filter((domain) => domain.name === DOMAIN)).toHaveLength(1)
    expect(domainSetCreates()).toBe(1)
  })

  it('resumes a persisted plan after a ledger restart using the same action id', async () => {
    await startServer([])
    service = newService(adapter)

    const planned = await service.planDomain({ name: DOMAIN }, { requestedBy: 'usr_ops' })
    core.close()

    core = ActionCore.open({ path: databasePath, clock: () => new Date() })
    service = newService(adapter)

    const resumed = await service.provisionDomain(
      { name: DOMAIN },
      { requestedBy: 'usr_ops', confirm: true },
    )
    expect(resumed.action.id).toBe(planned.action.id)
    expect(resumed.action.status).toBe('completed')
    expect(server.getDomains()).toHaveLength(1)
    expect(domainSetCreates()).toBe(1)
  })

  it('fails closed without explicit confirmation and performs no mutation', async () => {
    await startServer([])
    service = newService(adapter)

    await expect(
      service.provisionDomain({ name: DOMAIN }, { requestedBy: 'usr_ops', confirm: false }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })

    expect(core.actionService.listActions()).toHaveLength(0)
    expect(server.getDomains()).toHaveLength(0)
    expect(domainSetCreates()).toBe(0)
  })

  it('rolls back exactly the created domain and proves absence', async () => {
    await startServer([])
    service = newService(adapter)

    const created = await service.provisionDomain(
      { name: DOMAIN },
      { requestedBy: 'usr_ops', confirm: true },
    )

    const rolled = await service.rollbackDomain(created.action.id)
    expect(rolled.action.status).toBe('rolled_back')
    expect(server.getDomains()).toHaveLength(0)
    expect(domainSetDestroys()).toBe(1)
  })

  it('refuses a differing pre-existing domain before mutation and performs zero Domain/set', async () => {
    await startServer([{ id: 'd1', name: DOMAIN, description: 'legacy' }])
    service = newService(adapter)

    // The plan truthfully describes an update against the foreign domain.
    const planned = await service.planDomain(
      { name: DOMAIN, description: 'new' },
      { requestedBy: 'usr_ops' },
    )
    expect(planned.action.status).toBe('planned')
    expect(planned.action.diff?.changes.map((change) => change.path)).toContain('description')

    await expect(
      service.provisionDomain(
        { name: DOMAIN, description: 'new' },
        { requestedBy: 'usr_ops', confirm: true },
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    // The pre-existing domain is untouched and no mutation was sent upstream.
    expect(server.getDomains()).toHaveLength(1)
    expect(server.getDomains()[0]?.description).toBe('legacy')
    expect(domainSetCreates()).toBe(0)
    expect(server.jmapCalls.some((call) => call.method === 'x:Domain/set')).toBe(false)

    // Rejected before approval, job creation, attempt reservation or dispatch.
    const [action] = core.actionService.listActions({ name: 'organization.domain.create' })
    expect(action?.status).toBe('planned')
    expect(action?.error).toBeUndefined()
    expect(core.actionService.getAttempts(action?.id ?? '')).toHaveLength(0)
    expect(core.approvals.listByAction(action?.id ?? '')).toHaveLength(0)
    expect(core.jobs.list()).toHaveLength(0)
  })

  it('treats an exact existing domain as a completed no-op with no rollback', async () => {
    await startServer([{ id: 'd1', name: DOMAIN }])
    service = newService(adapter)

    const view = await service.provisionDomain(
      { name: DOMAIN },
      { requestedBy: 'usr_ops', confirm: true },
    )

    expect(view.action.status).toBe('completed')
    expect(view.action.canRollback).toBe(false)
    expect(server.getDomains()).toHaveLength(1)
    expect(server.jmapCalls.some((call) => call.method === 'x:Domain/set')).toBe(false)

    await expect(service.rollbackDomain(view.action.id)).rejects.toMatchObject({
      code: 'ACTION_BLOCKED',
    })
    expect(server.getDomains()).toHaveLength(1)
  })

  it('rejects an invalid domain name before reaching the engine', async () => {
    await startServer([])
    service = newService(adapter)

    await expect(
      service.planDomain({ name: 'not a domain' }, { requestedBy: 'usr_ops' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(server.jmapCalls).toHaveLength(0)
  })

  it('returns a typed SERVICE_UNAVAILABLE when the engine is unconfigured', async () => {
    await startServer([])
    const offline = newService(null)
    await expect(
      offline.planDomain({ name: DOMAIN }, { requestedBy: 'usr_ops' }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })

  it('records a truthful failed action when the engine rejects the mutation', async () => {
    await startServer([])
    service = newService(adapter)
    server.failNextMethod('x:Domain/set', { type: 'serverFail', description: 'engine exploded' })

    await expect(
      service.provisionDomain({ name: DOMAIN }, { requestedBy: 'usr_ops', confirm: true }),
    ).rejects.toBeTruthy()

    const [action] = core.actionService.listActions({ name: 'organization.domain.create' })
    expect(action?.status).toBe('failed')
    expect(action?.error?.details?.needsAttention).toBe(true)
    expect(server.getDomains()).toHaveLength(0)
  })

  it('cannot read or roll back a foreign action through the domain API', async () => {
    await startServer([])
    service = newService(adapter)

    const foreign = core.actionService.stageAction({
      name: 'organization.alias.create',
      surface: 'control',
      riskTier: 1,
      parameters: { address: 'sales@example.com', target: 'alice@example.com' },
      requestedBy: 'usr_ops',
      canRollback: true,
    })

    expect(() => service.getDomainAction(foreign.action.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    await expect(service.rollbackDomain(foreign.action.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    // The foreign action is untouched by the rejected rollback attempt.
    expect(core.actions.require(foreign.action.id).status).toBe('staged')
  })

  it('keeps evidence isolated per action for the same domain across pagination', async () => {
    await startServer([])
    service = newService(adapter)

    const first = await service.provisionDomain(
      { name: DOMAIN },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'org-domain-isolation-1' },
    )
    const second = await service.provisionDomain(
      { name: DOMAIN },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'org-domain-isolation-2' },
    )

    expect(second.action.id).not.toBe(first.action.id)
    const target = `domain:${DOMAIN}`

    // Push the first action's evidence past a single page (page size is 200).
    for (let index = 0; index < 250; index += 1) {
      core.evidence.append({
        checkType: 'custom_check',
        status: 'passed',
        target,
        collector: 'test:paging',
        details: { actionId: first.action.id, index },
        rawOutputRedacted: `observed-${index}`,
      })
    }

    const firstView = service.getDomainAction(first.action.id)
    const secondView = service.getDomainAction(second.action.id)
    expect(firstView.evidence.length).toBeGreaterThan(200)
    expect(firstView.evidence.every((record) => record.details.actionId === first.action.id)).toBe(
      true,
    )
    expect(secondView.evidence.length).toBeGreaterThan(0)
    expect(
      secondView.evidence.every((record) => record.details.actionId === second.action.id),
    ).toBe(true)

    // The second action ran against the existing domain; no duplicate create.
    expect(domainSetCreates()).toBe(1)
  })

  it('refuses to roll back a domain that acquired a dependent mailbox', async () => {
    await startServer([])
    service = newService(adapter)

    const created = await service.provisionDomain(
      { name: DOMAIN },
      { requestedBy: 'usr_ops', confirm: true },
    )
    expect(created.action.status).toBe('completed')

    // A mailbox is created under the new domain after the domain action completed.
    const discovered = await adapter.discover()
    const domainId = discovered.domains.find((domain) => domain.name === DOMAIN)?.id
    expect(domainId).toBeDefined()
    const mailboxPlan = await adapter.planMailbox({ email: `alice@${DOMAIN}` })
    const applied = await adapter.apply(mailboxPlan)
    expect(applied.ok).toBe(true)
    expect(server.getAccounts()).toHaveLength(1)

    await expect(service.rollbackDomain(created.action.id)).rejects.toMatchObject({
      code: 'ACTION_BLOCKED',
    })

    // Neither the domain nor its mailbox was destroyed.
    const action = core.actions.require(created.action.id)
    expect(action.status).toBe('rollback_failed')
    expect(server.getDomains().some((domain) => domain.name === DOMAIN)).toBe(true)
    expect(server.getAccounts()).toHaveLength(1)
    expect(domainSetDestroys()).toBe(0)
  })

  it('treats a domain discovery failure during rollback as needsAttention and destroys nothing', async () => {
    await startServer([])
    service = newService(adapter)

    const created = await service.provisionDomain(
      { name: DOMAIN },
      { requestedBy: 'usr_ops', confirm: true },
    )
    expect(created.action.status).toBe('completed')

    // Discovery cannot be completed, so it is never a licence to destroy.
    adapter.discover = async () => {
      throw new Error('discovery exploded')
    }

    await expect(service.rollbackDomain(created.action.id)).rejects.toBeTruthy()

    const action = core.actions.require(created.action.id)
    expect(action.status).toBe('rollback_failed')
    expect(action.error?.details?.needsAttention).toBe(true)
    expect(server.getDomains().some((domain) => domain.name === DOMAIN)).toBe(true)
    expect(domainSetDestroys()).toBe(0)
  })

  it('fails closed when dependency discovery is fail-soft and returns warnings', async () => {
    await startServer([])
    service = newService(adapter)

    const created = await service.provisionDomain(
      { name: DOMAIN },
      { requestedBy: 'usr_ops', confirm: true },
    )
    expect(created.action.status).toBe('completed')

    // `discover` is fail-soft: it can report empty children while warning that it
    // could not enumerate them. An incomplete enumeration must never authorise a
    // destroy.
    const warningText = 'discovery of mailboxes failed: http://127.0.0.1:1234 admin'
    const realDiscover = adapter.discover.bind(adapter)
    adapter.discover = async (options) => {
      const report = await realDiscover(options)
      return { ...report, warnings: [warningText] }
    }

    let thrown: unknown
    try {
      await service.rollbackDomain(created.action.id)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'ACTION_BLOCKED', details: { warningCount: 1 } })
    // Raw warning text (which may contain endpoint details) is never surfaced.
    expect(JSON.stringify(thrown)).not.toContain('127.0.0.1')
    expect(JSON.stringify(thrown)).not.toContain('discovery of mailboxes failed')

    const action = core.actions.require(created.action.id)
    expect(action.status).toBe('rollback_failed')
    expect(action.error?.details?.needsAttention).toBe(true)
    expect(JSON.stringify(action.error)).not.toContain('127.0.0.1')
    expect(server.getDomains().some((domain) => domain.name === DOMAIN)).toBe(true)
    expect(domainSetDestroys()).toBe(0)
  })
})
