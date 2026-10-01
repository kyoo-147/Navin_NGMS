import type { Clock } from '../ports/clock.js'
import type { Database } from '../ports/database.js'
import { computeMigrationChecksum, type Migration } from './migrations.js'

const MIGRATIONS_TABLE = 'schema_migrations'

interface MigrationRow {
  id: number
  name: string
  checksum: string
  applied_at: string
}

export interface AppliedMigration {
  id: number
  name: string
  checksum: string
  appliedAt: string
}

export interface MigrationStatus {
  applied: AppliedMigration[]
  pending: number[]
  latest: number
}

export interface MigrationResult {
  applied: number[]
  total: number
}

/**
 * Runs ordered migrations exactly once and records them in `schema_migrations`.
 *
 * The runner is idempotent, refuses to run with an inconsistent definition,
 * and applies each migration inside its own transaction so a failure leaves
 * the database on the last successfully applied migration. Each applied row
 * stores a checksum of the migration's SQL; a changed body under the same
 * id/name is rejected as drift rather than silently skipped.
 */
export class Migrator {
  constructor(
    private readonly database: Database,
    private readonly migrations: readonly Migration[],
    private readonly clock: Clock,
  ) {}

  ensureTable(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `)
  }

  status(): MigrationStatus {
    this.ensureTable()
    const rows = this.readApplied()
    const appliedIds = new Set(rows.map((row) => row.id))
    const pending = this.sortedMigrations()
      .filter((migration) => !appliedIds.has(migration.id))
      .map((migration) => migration.id)

    return {
      applied: rows.map((row) => ({
        id: row.id,
        name: row.name,
        checksum: row.checksum,
        appliedAt: row.applied_at,
      })),
      pending,
      latest: this.sortedMigrations().reduce((max, migration) => Math.max(max, migration.id), 0),
    }
  }

  migrate(): MigrationResult {
    this.ensureTable()
    this.validateDefinition()

    const appliedIds = new Set(this.readApplied().map((row) => row.id))
    const appliedNow: number[] = []

    for (const migration of this.sortedMigrations()) {
      if (appliedIds.has(migration.id)) {
        continue
      }
      const checksum = computeMigrationChecksum(migration)
      this.database.transaction((database) => {
        database.exec(migration.sql)
        database.run(
          `INSERT INTO ${MIGRATIONS_TABLE} (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
          [migration.id, migration.name, checksum, this.clock.nowIso()],
        )
      })
      appliedNow.push(migration.id)
    }

    return { applied: appliedNow, total: this.migrations.length }
  }

  private readApplied(): MigrationRow[] {
    return this.database.all<MigrationRow>(
      `SELECT id, name, checksum, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY id`,
    )
  }

  private sortedMigrations(): Migration[] {
    return [...this.migrations].sort((a, b) => a.id - b.id)
  }

  private validateDefinition(): void {
    const byId = new Map<number, Migration>()
    for (const migration of this.migrations) {
      if (!Number.isInteger(migration.id) || migration.id < 1) {
        throw new Error(`Invalid migration id: ${migration.id}`)
      }
      if (byId.has(migration.id)) {
        throw new Error(`Duplicate migration id: ${migration.id}`)
      }
      byId.set(migration.id, migration)
    }

    for (const row of this.readApplied()) {
      const known = byId.get(row.id)
      if (!known) {
        throw new Error(`Database has unknown migration id ${row.id} (${row.name})`)
      }
      const expected = computeMigrationChecksum(known)
      if (row.checksum !== expected) {
        throw new Error(
          `Migration ${row.id} (${known.name}) checksum drift: database has ${row.checksum}, code expects ${expected}`,
        )
      }
    }
  }
}
