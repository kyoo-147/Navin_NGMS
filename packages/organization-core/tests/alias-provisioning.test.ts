import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActionCore } from '@navin/action-core'
import { StalwartEngineAdapter } from '@navin/engine-core'
import { StalwartFixtureServer } from '@navin/engine-core/testing'
import { OrganizationService, validateIdempotencyKey } from '../src/index.js'

const TOKEN = 'organization-core-test-token'
const ADDRESS = 'sales@example.com'
const TARGET = 'alice@example.com'

let dir: string
let databasePath: string
let core: ActionCore
let server: StalwartFixtureServer
let adapter: StalwartEngineAdapter
let service: OrganizationService

function newService(engine: StalwartEngineAdapter | null): OrganizationService {
  return new OrganizationService({ core, engine, clock: () => new Date() })
}

function aliasSetCreates(): number {
  return server.jmapCalls.filter(
    (call) =>
      call.method === 'x:Alias/set' &&
      call.args.create !== null &&
      typeof call.args.create === 'object',
  ).length
}

beforeEach(async () => {
  server = new StalwartFixtureServer({
    token: TOKEN,
    domains: [{ id: 'd1', name: 'example.com' }],
    accounts: [{ id: 'a1', name: 'alice', domainId: 'd1' }],
    aliases: [],
  })
  await server.start()
  adapter = new StalwartEngineAdapter({
    endpoint: server.url,
    token: TOKEN,
    retry: { attempts: 1 },
  })
  dir = mkdtempSync(join(tmpdir(), 'organization-core-'))
  databasePath = join(dir, 'actions.db')
  core = ActionCore.open({ path: databasePath, clock: () => new Date() })
  service = newService(adapter)
})

afterEach(async () => {
  if (core.describe().open) core.close()
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('organization alias provisioning', () => {
  it('plans the exact alias change without touching the engine', async () => {
    const view = await service.planAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops' },
    )

    expect(view.action.status).toBe('planned')
    expect(view.action.riskTier).toBe(1)
    expect(view.action.canRollback).toBe(true)
    const paths = view.action.diff?.changes.map((change) => change.path) ?? []
    expect(paths).toContain('name')
    expect(paths).toContain('target')
    expect(paths).toContain('domainId')
    expect(server.getAliases()).toHaveLength(0)
    expect(aliasSetCreates()).toBe(0)
  })

  it('applies, verifies and records real evidence for a reversible create', async () => {
    const view = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true },
    )

    expect(view.action.status).toBe('completed')
    expect(view.action.verification?.passed).toBe(true)
    expect(view.job?.status).toBe('completed')
    expect(view.attempts.map((attempt) => attempt.status)).toContain('succeeded')
    expect(view.evidence.some((record) => record.status === 'passed')).toBe(true)
    expect(server.getAliases().some((alias) => alias.name === 'sales')).toBe(true)
    expect(aliasSetCreates()).toBe(1)
  })

  it('is idempotent: a repeated call returns the same action and never duplicates the alias', async () => {
    const first = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true },
    )
    const second = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true },
    )

    expect(second.action.id).toBe(first.action.id)
    expect(second.action.status).toBe('completed')
    expect(server.getAliases().filter((alias) => alias.name === 'sales')).toHaveLength(1)
    expect(aliasSetCreates()).toBe(1)
  })

  it('resumes a persisted plan after a ledger restart using the same action id', async () => {
    const planned = await service.planAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops' },
    )
    core.close()

    core = ActionCore.open({ path: databasePath, clock: () => new Date() })
    service = newService(adapter)

    const resumed = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true },
    )
    expect(resumed.action.id).toBe(planned.action.id)
    expect(resumed.action.status).toBe('completed')
    expect(server.getAliases()).toHaveLength(1)
  })

  it('fails closed without explicit confirmation and performs no mutation', async () => {
    await expect(
      service.provisionAlias(
        { address: ADDRESS, target: TARGET },
        { requestedBy: 'usr_ops', confirm: false },
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })

    expect(core.actionService.listActions()).toHaveLength(0)
    expect(server.getAliases()).toHaveLength(0)
  })

  it('rolls back exactly the created alias and proves absence', async () => {
    const created = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true },
    )

    const rolled = await service.rollbackAlias(created.action.id)
    expect(rolled.action.status).toBe('rolled_back')
    expect(server.getAliases()).toHaveLength(0)
  })

  it('rejects an invalid address before reaching the engine', async () => {
    await expect(
      service.planAlias({ address: 'not-an-address', target: TARGET }, { requestedBy: 'usr_ops' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(server.jmapCalls).toHaveLength(0)
  })

  it('returns a typed SERVICE_UNAVAILABLE when the engine is unconfigured', async () => {
    const offline = newService(null)
    await expect(
      offline.planAlias({ address: ADDRESS, target: TARGET }, { requestedBy: 'usr_ops' }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })

  it('records a truthful failed action with needsAttention when the engine rejects the mutation', async () => {
    server.failNextMethod('x:Alias/set', { type: 'serverFail', description: 'engine exploded' })

    await expect(
      service.provisionAlias(
        { address: ADDRESS, target: TARGET },
        { requestedBy: 'usr_ops', confirm: true },
      ),
    ).rejects.toBeTruthy()

    const [action] = core.actionService.listActions({ name: 'organization.alias.create' })
    expect(action?.status).toBe('failed')
    expect(action?.error?.details?.needsAttention).toBe(true)
    expect(server.getAliases()).toHaveLength(0)
  })

  it('cannot read or roll back a foreign action through the organization API', async () => {
    const foreign = core.actionService.stageAction({
      name: 'dns.update_dkim',
      surface: 'control',
      riskTier: 1,
      parameters: { selector: 'navin' },
      requestedBy: 'usr_ops',
      canRollback: true,
    })

    expect(() => service.getAliasAction(foreign.action.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    await expect(service.rollbackAlias(foreign.action.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    // The foreign action is untouched by the rejected rollback attempt.
    expect(core.actions.require(foreign.action.id).status).toBe('staged')
  })

  it('rejects empty, oversized and unsafe explicit idempotency keys', () => {
    expect(() => validateIdempotencyKey('')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    )
    expect(() => validateIdempotencyKey('   ')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    )
    expect(() => validateIdempotencyKey('a'.repeat(129))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    )
    expect(() => validateIdempotencyKey('bad key/with:chars')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    )
    expect(validateIdempotencyKey('Valid_key-1.2')).toBe('Valid_key-1.2')
  })

  it('rejects an empty idempotency key on the provision path', async () => {
    await expect(
      service.provisionAlias(
        { address: ADDRESS, target: TARGET },
        { requestedBy: 'usr_ops', confirm: true, idempotencyKey: '' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(server.getAliases()).toHaveLength(0)
  })

  it('repairs missing evidence for a settled action after a simulated crash without a duplicate mutation', async () => {
    const created = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'org-durable-1' },
    )
    const actionId = created.action.id
    const target = `alias:${ADDRESS}`
    expect(created.action.status).toBe('completed')
    expect(aliasSetCreates()).toBe(1)
    expect(
      core.evidence.list({ target }).some((record) => record.details.actionId === actionId),
    ).toBe(true)

    // Model the crash window: the action is complete but its evidence row is
    // missing. The ledger is append-only, so drop only the delete guard on this
    // disposable fixture database before removing the row.
    core.db.exec('DROP TRIGGER evidence_append_only_delete')
    core.db.prepare('DELETE FROM evidence WHERE target = ?').run(target)
    expect(core.evidence.list({ target })).toHaveLength(0)

    // Restart the ledger and retry the same request and key.
    core.close()
    core = ActionCore.open({ path: databasePath, clock: () => new Date() })
    service = newService(adapter)

    const repaired = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'org-durable-1' },
    )
    expect(repaired.action.id).toBe(actionId)
    expect(repaired.action.status).toBe('completed')
    expect(
      core.evidence.list({ target }).some((record) => record.details.actionId === actionId),
    ).toBe(true)
    // Evidence was restored without repeating the upstream mutation.
    expect(aliasSetCreates()).toBe(1)
    expect(server.getAliases().filter((alias) => alias.name === 'sales')).toHaveLength(1)
  })

  it('keeps evidence isolated per action for the same alias across pagination', async () => {
    const first = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'org-isolation-1' },
    )
    const second = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'org-isolation-2' },
    )

    expect(second.action.id).not.toBe(first.action.id)
    const target = `alias:${ADDRESS}`
    expect(core.evidence.list({ target }).map((record) => record.details.actionId)).toContain(
      first.action.id,
    )
    expect(core.evidence.list({ target }).map((record) => record.details.actionId)).toContain(
      second.action.id,
    )

    // Push the first action's evidence past a single page (page size is 200) so
    // the per-action lookup must page the ledger to stay complete.
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

    const firstView = service.getAliasAction(first.action.id)
    const secondView = service.getAliasAction(second.action.id)
    expect(firstView.evidence.length).toBeGreaterThan(200)
    expect(firstView.evidence.every((record) => record.details.actionId === first.action.id)).toBe(
      true,
    )
    expect(secondView.evidence.length).toBeGreaterThan(0)
    expect(
      secondView.evidence.every((record) => record.details.actionId === second.action.id),
    ).toBe(true)

    // The second action ran against the existing alias; no duplicate create.
    expect(aliasSetCreates()).toBe(1)
  })
})
