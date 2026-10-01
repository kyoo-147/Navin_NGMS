import { parseJson, stringifyJson, type SqliteDatabase } from '@navin/action-core'
import type { EnginePlan } from '@navin/engine-core'

import type { ValidatedAliasRequest } from './alias.js'

export interface AliasPlanRecord {
  actionId: string
  address: string
  target: string
  enginePlan: EnginePlan
  createdAt: string
}

export interface AliasOperationRecord {
  actionId: string
  jobId: string
  address: string
  target: string
  createdAt: string
}

interface PlanRow {
  action_id: string
  address: string
  target: string
  engine_plan_json: string
  created_at: string
}

interface OperationRow {
  action_id: string
  job_id: string
  address: string
  target: string
  created_at: string
}

/**
 * Durable side-tables owned by organization-core.
 *
 * They live in the same SQLite database (and connection) as the action ledger,
 * so the exact engine plan produced at `plan` time is available to `apply`,
 * `verify` and `rollback` after a daemon restart, and the job that owns an
 * action can be resolved by action id.
 */
export class OrganizationStore {
  constructor(private readonly db: SqliteDatabase) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organization_alias_plans (
        action_id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        target TEXT NOT NULL,
        engine_plan_id TEXT NOT NULL,
        engine_plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS organization_alias_operations (
        action_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        address TEXT NOT NULL,
        target TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS organization_alias_operations_job_idx
        ON organization_alias_operations(job_id);
    `)
  }

  savePlan(input: {
    actionId: string
    request: ValidatedAliasRequest
    enginePlan: EnginePlan
    createdAt: string
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO organization_alias_plans
           (action_id, address, target, engine_plan_id, engine_plan_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.actionId,
        input.request.address,
        input.request.target,
        input.enginePlan.planId,
        stringifyJson(input.enginePlan),
        input.createdAt,
      )
  }

  getPlan(actionId: string): AliasPlanRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM organization_alias_plans WHERE action_id = ?')
      .get(actionId) as PlanRow | undefined
    if (row === undefined) return undefined
    const enginePlan = parseJson<EnginePlan>(row.engine_plan_json)
    if (enginePlan === undefined) return undefined
    return {
      actionId: row.action_id,
      address: row.address,
      target: row.target,
      enginePlan,
      createdAt: row.created_at,
    }
  }

  linkJob(input: {
    actionId: string
    jobId: string
    request: ValidatedAliasRequest
    createdAt: string
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO organization_alias_operations
           (action_id, job_id, address, target, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.actionId,
        input.jobId,
        input.request.address,
        input.request.target,
        input.createdAt,
      )
  }

  getOperation(actionId: string): AliasOperationRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM organization_alias_operations WHERE action_id = ?')
      .get(actionId) as OperationRow | undefined
    if (row === undefined) return undefined
    return {
      actionId: row.action_id,
      jobId: row.job_id,
      address: row.address,
      target: row.target,
      createdAt: row.created_at,
    }
  }
}
