import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_STALWART_PROFILE,
  EngineError,
  StalwartEngineAdapter,
  type EnginePlan,
} from '../src/index.js'
import { StalwartFixtureServer } from '../src/testing/index.js'

const TOKEN = 'navin-test-token'

let server: StalwartFixtureServer
let adapter: StalwartEngineAdapter

beforeEach(async () => {
  server = new StalwartFixtureServer({
    token: TOKEN,
    version: '0.16.24',
    domains: [
      { id: 'd1', name: 'primary.navin.test', description: 'Primary' },
      { id: 'd2', name: 'secondary.navin.test', description: 'Secondary' },
    ],
    accounts: [
      { id: 'a1', name: 'admin', domainId: 'd1' },
      { id: 'a2', name: 'orphan', domainId: 'dX' },
    ],
    aliases: [
      {
        id: 'al1',
        name: 'sales',
        domainId: 'd1',
        target: 'admin@primary.navin.test',
        enabled: true,
      },
    ],
  })
  await server.start()
  adapter = new StalwartEngineAdapter({
    endpoint: server.url,
    token: TOKEN,
    engineVersion: '0.16.24',
    retry: { attempts: 1 },
  })
})

afterEach(async () => {
  await server.stop()
})

describe('Stalwart admin adapter', () => {
  it('talks only to the loopback fixture', () => {
    expect(server.url.startsWith('http://127.0.0.1:')).toBe(true)
    expect(adapter.descriptor.connection?.endpoint).toBe(server.url)
    expect(adapter.descriptor.engineId).toBe('stalwart')
  })

  it('requires credentials', () => {
    expect(() => new StalwartEngineAdapter({ endpoint: 'http://127.0.0.1:1' })).toThrowError(
      EngineError,
    )
  })

  it('reports health and degrades to liveness', async () => {
    const healthy = await adapter.health()
    expect(healthy.ok).toBe(true)
    expect(healthy.status).toBe('ready')

    server.setReady(false)
    const degraded = await adapter.health()
    expect(degraded.ok).toBe(false)
    expect(degraded.status).toBe('degraded')
    expect(degraded.checks.find((check) => check.name === 'liveness')?.passed).toBe(true)
  })

  it('reports unavailable when both health endpoints fail', async () => {
    server.enqueueResponse({ status: 500, body: { message: 'down' } })
    server.enqueueResponse({ status: 500, body: { message: 'down' } })

    const report = await adapter.health()
    expect(report.ok).toBe(false)
    expect(report.status).toBe('unavailable')
    expect(report.checks.every((check) => !check.passed)).toBe(true)
  })

  it('reads the engine version', async () => {
    const version = await adapter.version()
    expect(version.version).toBe('0.16.24')
    expect(version.product).toBe('Stalwart Mail Server')
    expect(version.engineId).toBe('stalwart')
  })

  it('discovers domains, mailboxes and aliases with warnings', async () => {
    const report = await adapter.discover()
    expect(report.counts).toEqual({ domains: 2, mailboxes: 2, aliases: 1 })
    expect(report.mailboxes.find((mailbox) => mailbox.name === 'admin')?.email).toBe(
      'admin@primary.navin.test',
    )
    expect(report.mailboxes.find((mailbox) => mailbox.name === 'orphan')?.email).toBe(
      'orphan@unknown.invalid',
    )
    expect(report.aliases[0]?.address).toBe('sales@primary.navin.test')
    expect(report.warnings.some((warning) => warning.includes('unknown domain'))).toBe(true)
    expect(report.secure).toBe(false)
  })

  it('records a warning when version discovery fails', async () => {
    const failing = new StalwartEngineAdapter({
      endpoint: server.url,
      token: TOKEN,
      engineVersion: '0.16.24',
      profile: { ...DEFAULT_STALWART_PROFILE, versionPath: '/missing' },
      retry: { attempts: 1 },
    })
    const report = await failing.discover()
    expect(report.warnings.some((warning) => warning.startsWith('Version discovery failed'))).toBe(
      true,
    )
    expect(report.counts.domains).toBe(2)
  })

  it('plans domain create, update and noop', async () => {
    const create = await adapter.planDomain({ name: 'New.Navin.TEST.' })
    expect(create.steps[0]?.op).toBe('create')
    expect(create.steps[0]?.target).toBe('new.navin.test')
    expect(create.noOp).toBe(false)
    expect(create.riskTier).toBe(1)
    expect(
      create.diff.changes.some((change) => change.path === 'name' && change.op === 'add'),
    ).toBe(true)

    const noop = await adapter.planDomain({ name: 'primary.navin.test', description: 'Primary' })
    expect(noop.noOp).toBe(true)
    expect(noop.riskTier).toBe(0)

    const update = await adapter.planDomain({ name: 'primary.navin.test', description: 'Changed' })
    expect(update.steps[0]?.op).toBe('update')
    expect(update.diff.changes).toContainEqual({
      path: 'description',
      op: 'replace',
      oldValue: 'Primary',
      newValue: 'Changed',
    })
  })
  it('verifies a no-op against live state instead of trusting the plan', async () => {
    const plan = await adapter.planDomain({ name: 'primary.navin.test', description: 'Primary' })
    const requestCount = server.requests.length
    const verified = await adapter.verify(plan)
    expect(verified.passed).toBe(true)
    expect(verified.checks[0]?.actual).toEqual({
      name: 'primary.navin.test',
      description: 'Primary',
    })
    expect(server.requests.length).toBeGreaterThan(requestCount)
  })

  it('refuses optimistic apply after the planned state drifts', async () => {
    const plan = await adapter.planDomain({ name: 'primary.navin.test', description: 'Updated' })
    const competing = await adapter.planDomain({
      name: 'primary.navin.test',
      description: 'Competing',
    })
    expect((await adapter.apply(competing)).ok).toBe(true)

    const result = await adapter.apply(plan)
    expect(result.ok).toBe(false)
    expect(result.steps[0]?.error?.code).toBe('PRECONDITION_FAILED')
    expect(server.getDomains().find((domain) => domain.id === 'd1')?.description).toBe('Competing')
  })

  it('refuses rollback when the applied resource has drifted', async () => {
    const plan = await adapter.planDomain({ name: 'primary.navin.test', description: 'Updated' })
    expect((await adapter.apply(plan)).ok).toBe(true)
    const competing = await adapter.planDomain({
      name: 'primary.navin.test',
      description: 'Competing',
    })
    expect((await adapter.apply(competing)).ok).toBe(true)

    const rollback = await adapter.rollback(plan)
    expect(rollback.passed).toBe(false)
    expect(rollback.steps[0]?.action).toBe('failed')
    expect(rollback.steps[0]?.error?.code).toBe('PRECONDITION_FAILED')
    expect(server.getDomains().find((domain) => domain.id === 'd1')?.description).toBe('Competing')
  })

  it('refuses rollback of a created resource after external mutation', async () => {
    const plan = await adapter.planDomain({ name: 'drift.navin.test', description: 'Created' })
    expect((await adapter.apply(plan)).ok).toBe(true)
    const competing = await adapter.planDomain({ name: 'drift.navin.test', description: 'Changed' })
    expect((await adapter.apply(competing)).ok).toBe(true)

    const rollback = await adapter.rollback(plan)
    expect(rollback.passed).toBe(false)
    expect(rollback.steps[0]?.error?.code).toBe('PRECONDITION_FAILED')
    expect(server.getDomains().some((domain) => domain.name === 'drift.navin.test')).toBe(true)
  })

  it('plans mailboxes and aliases and rejects unknown domains', async () => {
    const mailbox = await adapter.planMailbox({
      email: 'user@primary.navin.test',
      displayName: 'User',
    })
    expect(mailbox.steps[0]?.op).toBe('create')
    expect(mailbox.steps[0]?.desired.domainId).toBe('d1')

    const alias = await adapter.planAlias({
      address: 'info@primary.navin.test',
      target: 'admin@primary.navin.test',
    })
    expect(alias.steps[0]?.op).toBe('create')

    await expect(adapter.planMailbox({ email: 'user@absent.navin.test' })).rejects.toMatchObject({
      category: 'not_found',
    })
  })

  it('applies, verifies, idempotently re-applies and rolls back a domain', async () => {
    const plan = await adapter.planDomain({ name: 'apply.navin.test', description: 'Provisioned' })

    const applied = await adapter.apply(plan)
    expect(applied.ok).toBe(true)
    expect(applied.steps[0]?.status).toBe('applied')

    const verified = await adapter.verify(plan)
    expect(verified.passed).toBe(true)

    const again = await adapter.apply(plan)
    expect(again.ok).toBe(true)
    expect(again.steps[0]?.status).toBe('skipped')
    expect(server.getDomains().filter((domain) => domain.name === 'apply.navin.test')).toHaveLength(
      1,
    )

    const createCall = server.jmapCalls.find((call) => call.method === 'x:Domain/set')
    expect(createCall?.idempotencyKey).toBeDefined()

    const rolledBack = await adapter.rollback(plan)
    expect(rolledBack.passed).toBe(true)
    expect(rolledBack.steps[0]?.action).toBe('destroyed')
    expect(server.getDomains().some((domain) => domain.name === 'apply.navin.test')).toBe(false)
  })

  it('updates and rolls back to the previous observed state', async () => {
    const plan = await adapter.planDomain({ name: 'primary.navin.test', description: 'Updated' })

    const applied = await adapter.apply(plan)
    expect(applied.steps[0]?.status).toBe('applied')
    expect(server.getDomains().find((domain) => domain.id === 'd1')?.description).toBe('Updated')

    expect((await adapter.verify(plan)).passed).toBe(true)

    const rolledBack = await adapter.rollback(plan)
    expect(rolledBack.steps[0]?.action).toBe('reverted')
    expect(server.getDomains().find((domain) => domain.id === 'd1')?.description).toBe('Primary')
  })

  it('applies mailbox secrets out-of-band without exposing them in the plan', async () => {
    const plan = await adapter.planMailbox({
      email: 'user@primary.navin.test',
      displayName: 'User',
      password: 'fixture-password-value',
    })
    expect(JSON.stringify(plan)).not.toContain('fixture-password-value')

    const stepId = plan.steps[0]?.id ?? ''
    const applied = await adapter.apply(plan, {
      secrets: {
        [stepId]: {
          credentials: { '0': { '@type': 'Password', secret: 'fixture-password-value' } },
        },
      },
    })
    expect(applied.ok).toBe(true)

    const setCall = server.jmapCalls.find((call) => call.method === 'x:Account/set')
    const created = setCall?.args.create as Record<string, Record<string, unknown>> | undefined
    expect(JSON.stringify(created?.['new-mailbox'])).toContain('fixture-password-value')
    expect(server.getAccounts().some((account) => account.name === 'user')).toBe(true)
  })

  it('reports a failed step when apply fails', async () => {
    const domainPlan = await adapter.planDomain({ name: 'fail.navin.test' })
    const mailboxPlan = await adapter.planMailbox({ email: 'failuser@primary.navin.test' })
    const combined: EnginePlan = {
      ...domainPlan,
      planId: 'pln_fail',
      steps: [...domainPlan.steps, ...mailboxPlan.steps],
    }

    server.failNextMethod('x:Account/set', { type: 'serverFail', description: 'boom' })
    const result = await adapter.apply(combined)

    expect(result.ok).toBe(false)
    expect(result.rolledBack).toBe(false)
    expect(result.steps[1]?.status).toBe('failed')
    expect(result.steps[1]?.error?.code).toBe('INTERNAL_ERROR')
    expect(server.getDomains().some((domain) => domain.name === 'fail.navin.test')).toBe(true)
  })

  it('rolls back already-applied steps when rollbackOnFailure is enabled', async () => {
    const domainPlan = await adapter.planDomain({ name: 'atomic.navin.test' })
    const mailboxPlan = await adapter.planMailbox({ email: 'atomicuser@primary.navin.test' })
    const combined: EnginePlan = {
      ...domainPlan,
      planId: 'pln_atomic',
      steps: [...domainPlan.steps, ...mailboxPlan.steps],
    }

    server.failNextMethod('x:Account/set', { type: 'serverFail', description: 'boom' })
    const result = await adapter.apply(combined, { rollbackOnFailure: true })

    expect(result.ok).toBe(false)
    expect(result.rolledBack).toBe(true)
    expect(server.getDomains().some((domain) => domain.name === 'atomic.navin.test')).toBe(false)
  })

  it('surfaces authentication failures from the engine', async () => {
    const wrong = new StalwartEngineAdapter({
      endpoint: server.url,
      token: 'wrong',
      engineVersion: '0.16.24',
      retry: { attempts: 1 },
    })
    await expect(wrong.version()).rejects.toMatchObject({ category: 'unauthenticated' })
  })

  it('supports basic auth', async () => {
    const basicServer = new StalwartFixtureServer({ username: 'admin', password: 'pw' })
    await basicServer.start()
    try {
      const basicAdapter = new StalwartEngineAdapter({
        endpoint: basicServer.url,
        username: 'admin',
        password: 'pw',
        engineVersion: '0.16.24',
        retry: { attempts: 1 },
      })
      const version = await basicAdapter.version()
      expect(version.version).toBe('0.16.24')
    } finally {
      await basicServer.stop()
    }
  })

  it('honors timeout and cancellation', async () => {
    server.setLatency(150)
    await expect(adapter.version({ timeoutMs: 30 })).rejects.toMatchObject({ category: 'timeout' })

    const controller = new AbortController()
    const pending = adapter.version({ signal: controller.signal, timeoutMs: 5_000 })
    setTimeout(() => controller.abort(), 20)
    await expect(pending).rejects.toMatchObject({ category: 'cancelled' })
    server.setLatency(0)
  })
})
