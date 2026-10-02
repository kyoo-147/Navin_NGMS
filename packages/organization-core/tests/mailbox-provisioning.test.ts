import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActionCore } from '@navin/action-core'
import { StalwartEngineAdapter, type MailEngineAdapter } from '@navin/engine-core'
import { StalwartFixtureServer } from '@navin/engine-core/testing'
import { OrganizationService } from '../src/index.js'

const TOKEN = 'organization-core-mailbox-test-token'
const DOMAIN = 'example.com'
const EMAIL = 'alice@example.com'
const PASSWORD = 'correct-horse-battery-staple-1234'

interface SeededAccount {
  id: string
  name: string
  domainId: string
  description?: string
}

interface SeededAlias {
  id: string
  name: string
  domainId: string
  target: string
  enabled?: boolean
}

let dir: string
let databasePath: string
let core: ActionCore
let server: StalwartFixtureServer
let adapter: StalwartEngineAdapter
let service: OrganizationService

function newService(engine: MailEngineAdapter | null): OrganizationService {
  return new OrganizationService({ core, engine, clock: () => new Date() })
}

function accountSetCreates(): number {
  return server.jmapCalls.filter(
    (call) =>
      call.method === 'x:Account/set' &&
      call.args.create !== null &&
      typeof call.args.create === 'object',
  ).length
}

function accountSetMutations(): number {
  return server.jmapCalls.filter((call) => call.method === 'x:Account/set').length
}

function accountSetDestroys(): number {
  return server.jmapCalls.filter(
    (call) => call.method === 'x:Account/set' && Array.isArray(call.args.destroy),
  ).length
}

async function startServer(
  accounts: SeededAccount[] = [],
  aliases: SeededAlias[] = [],
): Promise<void> {
  server = new StalwartFixtureServer({
    token: TOKEN,
    domains: [{ id: 'd1', name: DOMAIN }],
    accounts,
    aliases,
  })
  await server.start()
  adapter = new StalwartEngineAdapter({
    endpoint: server.url,
    token: TOKEN,
    retry: { attempts: 1 },
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'organization-core-mailbox-'))
  databasePath = join(dir, 'actions.db')
  core = ActionCore.open({ path: databasePath, clock: () => new Date() })
})

afterEach(async () => {
  if (core.describe().open) core.close()
  if (server) await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('organization mailbox provisioning', () => {
  it('plans the exact mailbox change without touching the engine', async () => {
    await startServer()
    service = newService(adapter)

    const view = await service.planMailbox(
      { email: EMAIL, description: 'Alice' },
      { requestedBy: 'usr_ops' },
    )

    expect(view.action.status).toBe('planned')
    expect(view.action.riskTier).toBe(1)
    expect(view.action.canRollback).toBe(true)
    const paths = view.action.diff?.changes.map((change) => change.path) ?? []
    expect(paths).toContain('name')
    expect(paths).toContain('domainId')
    expect(paths).toContain('description')
    expect(server.getAccounts()).toHaveLength(0)
    expect(accountSetCreates()).toBe(0)
  })

  it('creates, verifies and records evidence, keeping the password out of every persisted surface', async () => {
    await startServer()
    service = newService(adapter)

    const view = await service.provisionMailbox(
      { email: EMAIL, description: 'Alice', password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true },
    )

    expect(view.action.status).toBe('completed')
    expect(view.action.verification?.passed).toBe(true)
    expect(view.action.canRollback).toBe(true)
    expect(view.job?.status).toBe('completed')
    expect(view.evidence.some((record) => record.status === 'passed')).toBe(true)
    expect(accountSetCreates()).toBe(1)

    // The password reaches the engine only on the Account create payload.
    const setCall = server.jmapCalls.find((call) => call.method === 'x:Account/set')
    expect(JSON.stringify(setCall?.args)).toContain(PASSWORD)

    // Never in the action view (parameters, diff, verification, evidence).
    expect(JSON.stringify(view)).not.toContain(PASSWORD)
    expect(view.action.parameters).toEqual({ email: EMAIL, description: 'Alice' })

    // Never in the job payload, result or progress.
    const job = core.jobs.require(view.job?.id ?? '')
    expect(JSON.stringify(job)).not.toContain(PASSWORD)

    // Never in the persisted engine plan, idempotency payload or the store.
    const planRows = core.db
      .prepare('SELECT engine_plan_json FROM organization_plans')
      .all() as unknown as { engine_plan_json: string }[]
    expect(JSON.stringify(planRows)).not.toContain(PASSWORD)
    const idempotencyRows = core.db.prepare('SELECT * FROM idempotency').all()
    expect(JSON.stringify(idempotencyRows)).not.toContain(PASSWORD)
  })

  it('treats an exact existing mailbox as a completed no-op with no rollback and no login claim', async () => {
    await startServer([{ id: 'a1', name: 'alice', domainId: 'd1', description: 'Alice' }])
    service = newService(adapter)

    const view = await service.provisionMailbox(
      { email: EMAIL, description: 'Alice', password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true },
    )

    expect(view.action.status).toBe('completed')
    expect(view.action.canRollback).toBe(false)
    expect(accountSetMutations()).toBe(0)
    expect(server.getAccounts()).toHaveLength(1)

    // A no-op never claims the password matched or that a login was verified.
    expect(JSON.stringify(view)).not.toContain(PASSWORD)
    expect(JSON.stringify(view.action.verification)).not.toMatch(/password|credential|login/i)

    await expect(
      service.rollbackMailbox(view.action.id, { typedConfirmation: EMAIL }),
    ).rejects.toMatchObject({ code: 'ACTION_BLOCKED' })
    expect(server.getAccounts()).toHaveLength(1)
  })

  it('refuses a differing pre-existing mailbox before mutation and performs zero Account/set', async () => {
    await startServer([{ id: 'a1', name: 'alice', domainId: 'd1', description: 'legacy' }])
    service = newService(adapter)

    const planned = await service.planMailbox(
      { email: EMAIL, description: 'new' },
      { requestedBy: 'usr_ops' },
    )
    expect(planned.action.status).toBe('planned')
    expect(planned.action.diff?.changes.map((change) => change.path)).toContain('description')

    await expect(
      service.provisionMailbox(
        { email: EMAIL, description: 'new', password: PASSWORD },
        { requestedBy: 'usr_ops', confirm: true },
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    expect(server.getAccounts()).toHaveLength(1)
    expect(server.getAccounts()[0]?.description).toBe('legacy')
    expect(accountSetMutations()).toBe(0)

    // Rejected before approval, job creation, attempt reservation or dispatch.
    const [action] = core.actionService.listActions({ name: 'organization.mailbox.create' })
    expect(action?.status).toBe('planned')
    expect(action?.error).toBeUndefined()
    expect(core.actionService.getAttempts(action?.id ?? '')).toHaveLength(0)
    expect(core.approvals.listByAction(action?.id ?? '')).toHaveLength(0)
    expect(core.jobs.list()).toHaveLength(0)
  })

  it('fails closed without a password, then resumes the same action/job when it is resupplied', async () => {
    await startServer()
    service = newService(adapter)

    const failure = await service
      .provisionMailbox(
        { email: EMAIL, description: 'Alice' },
        { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'mailbox-secret-1' },
      )
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'ACTION_BLOCKED',
      details: { needsAttention: true, secretRequired: true },
    })

    // No mutation and no attempt were made; the action stays resumable.
    expect(accountSetCreates()).toBe(0)
    const [action] = core.actionService.listActions({ name: 'organization.mailbox.create' })
    expect(action?.status).toBe('approved')
    expect(core.actionService.getAttempts(action?.id ?? '')).toHaveLength(0)
    const [failedJob] = core.jobs.list({ name: 'organization.mailbox.provision' })
    expect(failedJob?.status).toBe('failed')

    const resumed = await service.provisionMailbox(
      { email: EMAIL, description: 'Alice', password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'mailbox-secret-1' },
    )
    expect(resumed.action.id).toBe(action?.id)
    expect(resumed.action.status).toBe('completed')
    // The resume reuses the same durable job rather than creating a new one.
    expect(resumed.job?.id).toBe(failedJob?.id)
    expect(accountSetCreates()).toBe(1)
    expect(server.getAccounts()).toHaveLength(1)
  })

  it('serializes concurrent duplicate requests without substituting or leaking a secret', async () => {
    await startServer()
    const otherPassword = 'cross-request-secret-9999'
    let enterApply!: () => void
    const applyEntered = new Promise<void>((resolve) => {
      enterApply = resolve
    })
    let releaseApply!: () => void
    const applyReleased = new Promise<void>((resolve) => {
      releaseApply = resolve
    })
    // A test-local engine wrapper that pauses the first apply deterministically,
    // so the second concurrent request is guaranteed to overlap the first.
    const gated: MailEngineAdapter = {
      descriptor: adapter.descriptor,
      health: (options) => adapter.health(options),
      version: (options) => adapter.version(options),
      discover: (options) => adapter.discover(options),
      planDomain: (spec, options) => adapter.planDomain(spec, options),
      planMailbox: (spec, options) => adapter.planMailbox(spec, options),
      planAlias: (spec, options) => adapter.planAlias(spec, options),
      apply: async (plan, options) => {
        enterApply()
        await applyReleased
        return adapter.apply(plan, options)
      },
      verify: (plan, options) => adapter.verify(plan, options),
      rollback: (plan, options) => adapter.rollback(plan, options),
    }
    service = newService(gated)

    const first = service.provisionMailbox(
      { email: EMAIL, description: 'Alice', password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'mailbox-race-1' },
    )
    // Wait until the first request owns the secret and is inside the engine call.
    await applyEntered

    // A second request for the same action with a different password must not
    // overwrite, read or clear the first request's secret: it fails closed.
    const second = service.provisionMailbox(
      { email: EMAIL, description: 'Alice', password: otherPassword },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'mailbox-race-1' },
    )
    await expect(second).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { needsAttention: true },
    })

    releaseApply()
    const view = await first
    expect(view.action.status).toBe('completed')
    expect(accountSetCreates()).toBe(1)
    expect(server.getAccounts()).toHaveLength(1)

    // The applied credential is the owner's secret, never the interloper's.
    const createCall = server.jmapCalls.find((call) => call.method === 'x:Account/set')
    expect(JSON.stringify(createCall?.args)).toContain(PASSWORD)
    expect(JSON.stringify(createCall?.args)).not.toContain(otherPassword)

    // Nothing leaks into the view, the error, or the persisted store.
    expect(JSON.stringify(view)).not.toContain(PASSWORD)
    expect(JSON.stringify(view)).not.toContain(otherPassword)
    const rows = core.db.prepare('SELECT * FROM evidence').all()
    expect(JSON.stringify(rows)).not.toContain(PASSWORD)
    expect(JSON.stringify(rows)).not.toContain(otherPassword)
  })

  it('fails a concurrent secretless duplicate closed without letting it borrow the owner secret', async () => {
    await startServer()
    let applyCount = 0
    let enterApply!: () => void
    const applyEntered = new Promise<void>((resolve) => {
      enterApply = resolve
    })
    let releaseApply!: () => void
    const applyReleased = new Promise<void>((resolve) => {
      releaseApply = resolve
    })
    const gated: MailEngineAdapter = {
      descriptor: adapter.descriptor,
      health: (options) => adapter.health(options),
      version: (options) => adapter.version(options),
      discover: (options) => adapter.discover(options),
      planDomain: (spec, options) => adapter.planDomain(spec, options),
      planMailbox: (spec, options) => adapter.planMailbox(spec, options),
      planAlias: (spec, options) => adapter.planAlias(spec, options),
      apply: async (plan, options) => {
        applyCount += 1
        enterApply()
        await applyReleased
        return adapter.apply(plan, options)
      },
      verify: (plan, options) => adapter.verify(plan, options),
      rollback: (plan, options) => adapter.rollback(plan, options),
    }
    service = newService(gated)

    const first = service.provisionMailbox(
      { email: EMAIL, description: 'Alice', password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'mailbox-race-2' },
    )
    await applyEntered

    // A concurrent duplicate without a password claims nothing of its own; it
    // must fail closed rather than run the same job under the first request's
    // claim or borrow its secret.
    const secondError = await service
      .provisionMailbox(
        { email: EMAIL, description: 'Alice' },
        { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'mailbox-race-2' },
      )
      .catch((error: unknown) => error)
    expect(secondError).toMatchObject({
      code: 'CONFLICT',
      details: { needsAttention: true },
    })
    expect(String(secondError)).not.toContain(PASSWORD)

    releaseApply()
    const view = await first
    expect(view.action.status).toBe('completed')
    // The duplicate never entered engine.apply, and exactly one create happened.
    expect(applyCount).toBe(1)
    expect(accountSetCreates()).toBe(1)
    expect(server.getAccounts()).toHaveLength(1)
    const createCall = server.jmapCalls.find((call) => call.method === 'x:Account/set')
    expect(JSON.stringify(createCall?.args)).toContain(PASSWORD)
    expect(JSON.stringify(view)).not.toContain(PASSWORD)
  })

  it('replays a completed action idempotently without a duplicate create or duplicate evidence', async () => {
    await startServer()
    service = newService(adapter)

    const created = await service.provisionMailbox(
      { email: EMAIL, password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'mailbox-replay-1' },
    )
    expect(created.action.status).toBe('completed')
    expect(created.evidence.length).toBeGreaterThan(0)
    const evidenceIds = created.evidence.map((record) => record.id).sort()

    // The durable-repair branch runs on this replay (a completed action whose
    // evidence append had been lost would be repaired); evidence is append-only
    // and deduplicated per action, so nothing is duplicated and no second
    // Account/set is sent.
    const replay = await service.provisionMailbox(
      { email: EMAIL, password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'mailbox-replay-1' },
    )
    expect(replay.action.id).toBe(created.action.id)
    expect(replay.action.status).toBe('completed')
    expect(replay.evidence.map((record) => record.id).sort()).toEqual(evidenceIds)
    expect(accountSetCreates()).toBe(1)
    expect(server.getAccounts()).toHaveLength(1)
  })

  it('rolls back exactly the created mailbox and proves absence after the exact typed confirmation', async () => {
    await startServer()
    service = newService(adapter)

    const created = await service.provisionMailbox(
      { email: EMAIL, password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true },
    )

    const rolled = await service.rollbackMailbox(created.action.id, { typedConfirmation: EMAIL })
    expect(rolled.action.status).toBe('rolled_back')
    expect(server.getAccounts()).toHaveLength(0)
    expect(accountSetDestroys()).toBe(1)
  })

  it('refuses a rollback without the exact mailbox address as typed confirmation', async () => {
    await startServer()
    service = newService(adapter)
    const created = await service.provisionMailbox(
      { email: EMAIL, password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true },
    )

    await expect(
      service.rollbackMailbox(created.action.id, { typedConfirmation: 'other@example.com' }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    await expect(service.rollbackMailbox(created.action.id)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    })
    expect(core.actions.require(created.action.id).status).toBe('completed')
    expect(server.getAccounts()).toHaveLength(1)
    expect(accountSetDestroys()).toBe(0)
  })

  it('refuses to roll back a mailbox that is still an alias destination', async () => {
    await startServer(
      [],
      [{ id: 'al1', name: 'sales', domainId: 'd1', target: EMAIL, enabled: true }],
    )
    service = newService(adapter)
    const created = await service.provisionMailbox(
      { email: EMAIL, password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true },
    )
    expect(created.action.status).toBe('completed')

    await expect(
      service.rollbackMailbox(created.action.id, { typedConfirmation: EMAIL }),
    ).rejects.toMatchObject({ code: 'ACTION_BLOCKED' })

    const action = core.actions.require(created.action.id)
    expect(action.status).toBe('rollback_failed')
    expect(action.error?.details?.needsAttention).toBe(true)
    expect(server.getAccounts()).toHaveLength(1)
    expect(accountSetDestroys()).toBe(0)
  })

  it('treats a discovery failure during rollback as needsAttention and destroys nothing', async () => {
    await startServer()
    service = newService(adapter)
    const created = await service.provisionMailbox(
      { email: EMAIL, password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true },
    )

    adapter.discover = async () => {
      throw new Error('discovery exploded')
    }

    await expect(
      service.rollbackMailbox(created.action.id, { typedConfirmation: EMAIL }),
    ).rejects.toBeTruthy()

    const action = core.actions.require(created.action.id)
    expect(action.status).toBe('rollback_failed')
    expect(action.error?.details?.needsAttention).toBe(true)
    expect(server.getAccounts()).toHaveLength(1)
    expect(accountSetDestroys()).toBe(0)
  })

  it('fails closed when dependency discovery is fail-soft and returns warnings', async () => {
    await startServer()
    service = newService(adapter)
    const created = await service.provisionMailbox(
      { email: EMAIL, password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true },
    )

    const warningText = 'discovery of aliases failed: http://127.0.0.1:1234 admin'
    const realDiscover = adapter.discover.bind(adapter)
    adapter.discover = async (options) => {
      const report = await realDiscover(options)
      return { ...report, warnings: [warningText] }
    }

    let thrown: unknown
    try {
      await service.rollbackMailbox(created.action.id, { typedConfirmation: EMAIL })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'ACTION_BLOCKED', details: { warningCount: 1 } })
    expect(JSON.stringify(thrown)).not.toContain('127.0.0.1')
    expect(JSON.stringify(thrown)).not.toContain('discovery of aliases failed')

    const action = core.actions.require(created.action.id)
    expect(action.status).toBe('rollback_failed')
    expect(action.error?.details?.needsAttention).toBe(true)
    expect(JSON.stringify(action.error)).not.toContain('127.0.0.1')
    expect(server.getAccounts()).toHaveLength(1)
    expect(accountSetDestroys()).toBe(0)
  })

  it('cannot read or roll back a foreign action through the mailbox API', async () => {
    await startServer()
    service = newService(adapter)

    const foreign = core.actionService.stageAction({
      name: 'organization.alias.create',
      surface: 'control',
      riskTier: 1,
      parameters: { address: 'sales@example.com', target: EMAIL },
      requestedBy: 'usr_ops',
      canRollback: true,
    })

    expect(() => service.getMailboxAction(foreign.action.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    expect(() => service.mailboxRollbackTarget(foreign.action.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    await expect(
      service.rollbackMailbox(foreign.action.id, { typedConfirmation: EMAIL }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(core.actions.require(foreign.action.id).status).toBe('staged')
  })

  it('keeps evidence isolated per action for the same mailbox across pagination', async () => {
    await startServer()
    service = newService(adapter)

    const first = await service.provisionMailbox(
      { email: 'alice@example.com', password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'mailbox-iso-1' },
    )
    const second = await service.provisionMailbox(
      { email: 'bob@example.com', password: PASSWORD },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'mailbox-iso-2' },
    )
    expect(second.action.id).not.toBe(first.action.id)

    const target = `mailbox:${EMAIL}`
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

    const firstView = service.getMailboxAction(first.action.id)
    const secondView = service.getMailboxAction(second.action.id)
    expect(firstView.evidence.length).toBeGreaterThan(200)
    expect(firstView.evidence.every((record) => record.details.actionId === first.action.id)).toBe(
      true,
    )
    expect(secondView.evidence.length).toBeGreaterThan(0)
    expect(
      secondView.evidence.every((record) => record.details.actionId === second.action.id),
    ).toBe(true)
    expect(accountSetCreates()).toBe(2)
  })

  it('rejects an invalid address or out-of-bounds password before reaching the engine', async () => {
    await startServer()
    service = newService(adapter)

    await expect(
      service.planMailbox({ email: 'not an address' }, { requestedBy: 'usr_ops' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    for (const password of ['short', 'x'.repeat(257)]) {
      let failure: unknown
      try {
        await service.provisionMailbox(
          { email: EMAIL, password },
          { requestedBy: 'usr_ops', confirm: true },
        )
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({ code: 'VALIDATION_FAILED' })
      // The rejected secret is never echoed back in the message or details.
      expect(String(failure)).not.toContain(password)
      expect(JSON.stringify((failure as { details?: unknown }).details ?? {})).not.toContain(
        password,
      )
    }
    expect(server.jmapCalls).toHaveLength(0)
  })

  it('returns a typed SERVICE_UNAVAILABLE when the engine is unconfigured', async () => {
    await startServer()
    const offline = newService(null)
    await expect(
      offline.planMailbox({ email: EMAIL }, { requestedBy: 'usr_ops' }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })
})
