import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActionCore } from '@navin/action-core'
import { StalwartEngineAdapter } from '@navin/engine-core'
import { StalwartFixtureServer } from '@navin/engine-core/testing'
import { OrganizationService } from '../src/index.js'

const TOKEN = 'alias-create-safety-token'
const ADDRESS = 'sales@example.com'
const TARGET = 'alice@example.com'

interface ExistingAlias {
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

async function startWith(existing: ExistingAlias[]): Promise<void> {
  server = new StalwartFixtureServer({
    token: TOKEN,
    domains: [{ id: 'd1', name: 'example.com' }],
    accounts: [{ id: 'a1', name: 'alice', domainId: 'd1' }],
    aliases: existing,
  })
  await server.start()
  adapter = new StalwartEngineAdapter({
    endpoint: server.url,
    token: TOKEN,
    retry: { attempts: 1 },
  })
  service = new OrganizationService({ core, engine: adapter, clock: () => new Date() })
}

function aliasSetMutations(): number {
  return server.jmapCalls.filter((call) => call.method === 'x:Alias/set').length
}

function aliasSetCreates(): number {
  return server.jmapCalls.filter(
    (call) =>
      call.method === 'x:Alias/set' &&
      call.args.create !== null &&
      typeof call.args.create === 'object',
  ).length
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'organization-core-alias-safety-'))
  databasePath = join(dir, 'actions.db')
  core = ActionCore.open({ path: databasePath, clock: () => new Date() })
})

afterEach(async () => {
  if (core.describe().open) core.close()
  if (server) await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('organization alias create-only safety', () => {
  it('refuses a differing pre-existing alias before mutation with zero Alias/set', async () => {
    await startWith([
      { id: 'al1', name: 'sales', domainId: 'd1', target: 'other@example.com', enabled: true },
    ])

    // plan is read-only and truthfully reports the conflicting update.
    const planned = await service.planAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops' },
    )
    expect(planned.action.status).toBe('planned')

    await expect(
      service.provisionAlias(
        { address: ADDRESS, target: TARGET },
        { requestedBy: 'usr_ops', confirm: true },
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    // The pre-existing alias is untouched and no mutation was sent upstream.
    expect(server.getAliases()).toHaveLength(1)
    expect(server.getAliases()[0]?.target).toBe('other@example.com')
    expect(aliasSetMutations()).toBe(0)

    // Rejected before approval, job creation, attempt reservation or dispatch.
    const [action] = core.actionService.listActions({ name: 'organization.alias.create' })
    expect(action?.status).toBe('planned')
    expect(action?.error).toBeUndefined()
    expect(core.actionService.getAttempts(action?.id ?? '')).toHaveLength(0)
    expect(core.approvals.listByAction(action?.id ?? '')).toHaveLength(0)
    expect(core.jobs.list()).toHaveLength(0)
  })

  it('treats an exact existing alias as a completed no-op with no rollback', async () => {
    await startWith([{ id: 'al1', name: 'sales', domainId: 'd1', target: TARGET, enabled: true }])

    const view = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true },
    )

    expect(view.action.status).toBe('completed')
    expect(view.action.canRollback).toBe(false)
    expect(server.getAliases()).toHaveLength(1)
    expect(aliasSetMutations()).toBe(0)

    await expect(service.rollbackAlias(view.action.id)).rejects.toMatchObject({
      code: 'ACTION_BLOCKED',
    })
    expect(server.getAliases()).toHaveLength(1)
  })

  it('still creates and rolls back a genuinely new alias', async () => {
    await startWith([])

    const created = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true },
    )
    expect(created.action.status).toBe('completed')
    expect(created.action.canRollback).toBe(true)
    expect(aliasSetCreates()).toBe(1)

    const rolled = await service.rollbackAlias(created.action.id)
    expect(rolled.action.status).toBe('rolled_back')
    expect(server.getAliases()).toHaveLength(0)
  })
})
