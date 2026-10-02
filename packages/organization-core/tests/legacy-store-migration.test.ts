import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActionCore } from '@navin/action-core'
import { StalwartEngineAdapter } from '@navin/engine-core'
import { StalwartFixtureServer } from '@navin/engine-core/testing'
import { OrganizationService, OrganizationStore } from '../src/index.js'

const TOKEN = 'organization-core-legacy-migration-token'
const ADDRESS = 'sales@example.com'
const TARGET = 'alice@example.com'

// The exact W31 alias-only schema, reproduced to model a database written by the
// previous release before the generic resource-kind tables existed.
const LEGACY_PLANS_DDL = `CREATE TABLE organization_alias_plans (
  action_id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  target TEXT NOT NULL,
  engine_plan_id TEXT NOT NULL,
  engine_plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);`
const LEGACY_OPERATIONS_DDL = `CREATE TABLE organization_alias_operations (
  action_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  address TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL
);`

let dir: string
let databasePath: string
let core: ActionCore
let server: StalwartFixtureServer
let adapter: StalwartEngineAdapter
let service: OrganizationService

function newService(): OrganizationService {
  return new OrganizationService({ core, engine: adapter, clock: () => new Date() })
}

function tableExists(name: string): boolean {
  const row = core.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name)
  return row !== undefined
}

function countRows(table: string): number {
  const row = core.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  return Number(row.c)
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
  dir = mkdtempSync(join(tmpdir(), 'organization-core-legacy-'))
  databasePath = join(dir, 'actions.db')
  core = ActionCore.open({ path: databasePath, clock: () => new Date() })
})

afterEach(async () => {
  if (core.describe().open) core.close()
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('organization legacy store migration', () => {
  it('copies W31 alias plans/jobs into the generic tables, preserves the legacy rows, and stays usable for status and rollback', async () => {
    service = newService()
    const created = await service.provisionAlias(
      { address: ADDRESS, target: TARGET },
      { requestedBy: 'usr_ops', confirm: true, idempotencyKey: 'legacy-migrate-1' },
    )
    const actionId = created.action.id
    const jobId = created.job?.id
    expect(created.action.status).toBe('completed')
    expect(jobId).toBeDefined()

    // Capture the persisted generic rows, then downgrade the schema to W31.
    const planRow = core.db
      .prepare('SELECT * FROM organization_plans WHERE action_id = ?')
      .get(actionId) as { engine_plan_id: string; engine_plan_json: string; created_at: string }
    const opRow = core.db
      .prepare('SELECT * FROM organization_operations WHERE action_id = ?')
      .get(actionId) as { job_id: string; created_at: string }

    core.db.exec('DROP TABLE organization_plans')
    core.db.exec('DROP TABLE organization_operations')
    core.db.exec(LEGACY_PLANS_DDL)
    core.db.exec(LEGACY_OPERATIONS_DDL)
    core.db
      .prepare(
        `INSERT INTO organization_alias_plans
           (action_id, address, target, engine_plan_id, engine_plan_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        actionId,
        ADDRESS,
        TARGET,
        planRow.engine_plan_id,
        planRow.engine_plan_json,
        planRow.created_at,
      )
    core.db
      .prepare(
        `INSERT INTO organization_alias_operations
           (action_id, job_id, address, target, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(actionId, opRow.job_id, ADDRESS, TARGET, opRow.created_at)

    expect(tableExists('organization_plans')).toBe(false)
    expect(tableExists('organization_alias_plans')).toBe(true)

    // Restart on the legacy database: migrate must rebuild the generic tables and
    // copy every legacy row forward.
    core.close()
    core = ActionCore.open({ path: databasePath, clock: () => new Date() })
    service = newService()

    const migrated = new OrganizationStore(core.db)
    const plan = migrated.getPlan(actionId)
    expect(plan).toBeDefined()
    expect(plan?.resourceKind).toBe('alias')
    expect(plan?.resourceKey).toBe(ADDRESS)
    expect(plan?.enginePlan.planId).toBe(planRow.engine_plan_id)
    expect(plan?.createdAt).toBe(planRow.created_at)

    const operation = migrated.getOperation(actionId)
    expect(operation?.resourceKind).toBe('alias')
    expect(operation?.resourceKey).toBe(ADDRESS)
    expect(operation?.jobId).toBe(opRow.job_id)

    // Legacy data is never dropped, and repeated migration is a no-op.
    expect(countRows('organization_alias_plans')).toBe(1)
    expect(countRows('organization_alias_operations')).toBe(1)
    migrated.migrate()
    migrated.migrate()
    expect(countRows('organization_plans')).toBe(1)
    expect(countRows('organization_operations')).toBe(1)

    // The migrated plan + job link keep status and rollback fully operable.
    const status = service.getAliasAction(actionId)
    expect(status.action.status).toBe('completed')
    expect(status.job?.id).toBe(opRow.job_id)

    const rolled = await service.rollbackAlias(actionId)
    expect(rolled.action.status).toBe('rolled_back')
    expect(server.getAliases()).toHaveLength(0)
  })
})
