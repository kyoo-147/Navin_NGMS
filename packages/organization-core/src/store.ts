import { parseJson, stringifyJson, type SqliteDatabase } from '@navin/action-core'
import type { EnginePlan, EngineResourceKind } from '@navin/engine-core'

export interface OrganizationPlanRecord {
  actionId: string
  resourceKind: EngineResourceKind
  resourceKey: string
  enginePlan: EnginePlan
  createdAt: string
}

export interface OrganizationOperationRecord {
  actionId: string
  jobId: string
  resourceKind: EngineResourceKind
  resourceKey: string
  createdAt: string
}

interface PlanRow {
  action_id: string
  resource_kind: string
  resource_key: string
  engine_plan_json: string
  created_at: string
}

interface OperationRow {
  action_id: string
  job_id: string
  resource_kind: string
  resource_key: string
  created_at: string
}

/**
 * Durable side-tables owned by organization-core.
 *
 * They live in the same SQLite database (and connection) as the action ledger,
 * so the exact engine plan produced at `plan` time is available to `apply`,
 * `verify` and `rollback` after a daemon restart, and the job that owns an
 * action can be resolved by action id. Both reversible alias and domain actions
 * share these tables; `resource_kind` distinguishes them.
 */
export class OrganizationStore {
  constructor(private readonly db: SqliteDatabase) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organization_plans (
        action_id TEXT PRIMARY KEY,
        resource_kind TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        engine_plan_id TEXT NOT NULL,
        engine_plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS organization_operations (
        action_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS organization_operations_job_idx
        ON organization_operations(job_id);
    `)
    this.migrateLegacyAliasTables()
  }

  /**
   * Copies persisted W31 alias plans/jobs from the legacy alias-only tables into
   * the generic resource-kind tables.
   *
   * It is idempotent (`INSERT OR IGNORE` on the primary key) and runs in a
   * transaction, so re-running on every boot is safe. Legacy rows are never
   * dropped: the legacy tables stay the system of record for an operator to
   * retire once the new rows are verified.
   */
  private migrateLegacyAliasTables(): void {
    const legacyTables = new Set(
      (
        this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string
        }>
      ).map((row) => row.name),
    )
    const hasPlans = legacyTables.has('organization_alias_plans')
    const hasOperations = legacyTables.has('organization_alias_operations')
    if (!hasPlans && !hasOperations) {
      return
    }

    this.db.transaction(() => {
      if (hasPlans) {
        this.db.exec(`
          INSERT OR IGNORE INTO organization_plans
            (action_id, resource_kind, resource_key, engine_plan_id, engine_plan_json, created_at)
          SELECT action_id, 'alias', address, engine_plan_id, engine_plan_json, created_at
          FROM organization_alias_plans
        `)
      }
      if (hasOperations) {
        this.db.exec(`
          INSERT OR IGNORE INTO organization_operations
            (action_id, job_id, resource_kind, resource_key, created_at)
          SELECT action_id, job_id, 'alias', address, created_at
          FROM organization_alias_operations
        `)
      }
    })
  }

  savePlan(input: {
    actionId: string
    resourceKind: EngineResourceKind
    resourceKey: string
    enginePlan: EnginePlan
    createdAt: string
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO organization_plans
           (action_id, resource_kind, resource_key, engine_plan_id, engine_plan_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.actionId,
        input.resourceKind,
        input.resourceKey,
        input.enginePlan.planId,
        stringifyJson(input.enginePlan),
        input.createdAt,
      )
  }

  getPlan(actionId: string): OrganizationPlanRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM organization_plans WHERE action_id = ?')
      .get(actionId) as PlanRow | undefined
    if (row === undefined) return undefined
    const enginePlan = parseJson<EnginePlan>(row.engine_plan_json)
    if (enginePlan === undefined) return undefined
    return {
      actionId: row.action_id,
      resourceKind: row.resource_kind as EngineResourceKind,
      resourceKey: row.resource_key,
      enginePlan,
      createdAt: row.created_at,
    }
  }

  linkJob(input: {
    actionId: string
    jobId: string
    resourceKind: EngineResourceKind
    resourceKey: string
    createdAt: string
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO organization_operations
           (action_id, job_id, resource_kind, resource_key, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.actionId, input.jobId, input.resourceKind, input.resourceKey, input.createdAt)
  }

  getOperation(actionId: string): OrganizationOperationRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM organization_operations WHERE action_id = ?')
      .get(actionId) as OperationRow | undefined
    if (row === undefined) return undefined
    return {
      actionId: row.action_id,
      jobId: row.job_id,
      resourceKind: row.resource_kind as EngineResourceKind,
      resourceKey: row.resource_key,
      createdAt: row.created_at,
    }
  }
}
