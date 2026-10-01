import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../src/adapters/sqlite-database.js'
import {
  KERNEL_MIGRATIONS,
  computeMigrationChecksum,
  type Migration,
} from '../src/db/migrations.js'
import { Migrator } from '../src/db/migrator.js'
import { FixedClock, createTempDir, removeTempDir } from './support/test-helpers.js'

const FIRST_MIGRATION = KERNEL_MIGRATIONS[0] as Migration

describe('Migrator', () => {
  let dir: string
  let databasePath: string
  let database: SqliteDatabase
  const clock = new FixedClock()

  beforeEach(() => {
    dir = createTempDir()
    databasePath = join(dir, 'navin.db')
    database = SqliteDatabase.open({ path: databasePath })
  })

  afterEach(() => {
    if (database.isOpen) {
      database.close()
    }
    removeTempDir(dir)
  })

  it('applies every migration once and is idempotent', () => {
    const migrator = new Migrator(database, KERNEL_MIGRATIONS, clock)

    const first = migrator.migrate()
    expect(first.applied).toEqual([1, 2])
    expect(first.total).toBe(2)

    const second = migrator.migrate()
    expect(second.applied).toEqual([])

    const status = migrator.status()
    expect(status.pending).toEqual([])
    expect(status.applied.map((row) => row.id)).toEqual([1, 2])
    expect(status.latest).toBe(2)
  })

  it('persists applied migrations and checksums across a restart', () => {
    new Migrator(database, KERNEL_MIGRATIONS, clock).migrate()
    database.close()

    database = SqliteDatabase.open({ path: databasePath })
    const migrator = new Migrator(database, KERNEL_MIGRATIONS, clock)

    expect(migrator.migrate().applied).toEqual([])
    const status = migrator.status()
    expect(status.applied.map((row) => row.id)).toEqual([1, 2])
    expect(status.applied[0]?.checksum).toBe(computeMigrationChecksum(FIRST_MIGRATION))
  })

  it('rolls back the failing migration and leaves earlier ones applied', () => {
    const failing: Migration[] = [
      FIRST_MIGRATION,
      {
        id: 2,
        name: 'create_doomed_table',
        sql: 'CREATE TABLE doomed (id INTEGER PRIMARY KEY); THIS IS NOT VALID SQL;',
      },
    ]
    const migrator = new Migrator(database, failing, clock)

    expect(() => migrator.migrate()).toThrow()

    const status = migrator.status()
    expect(status.applied.map((row) => row.id)).toEqual([1])
    expect(status.pending).toEqual([2])

    const doomed = database.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'doomed'",
    )
    expect(doomed).toBeUndefined()
  })

  it('rejects a changed migration body under the same id and name', () => {
    new Migrator(database, KERNEL_MIGRATIONS, clock).migrate()

    const tampered = KERNEL_MIGRATIONS.map((migration) =>
      migration.id === 1 ? { ...migration, sql: `${migration.sql}\n-- changed` } : migration,
    )

    expect(() => new Migrator(database, tampered, clock).migrate()).toThrow(/checksum drift/)
  })

  it('detects drift after a restart', () => {
    new Migrator(database, KERNEL_MIGRATIONS, clock).migrate()
    database.close()

    database = SqliteDatabase.open({ path: databasePath })
    const tampered = KERNEL_MIGRATIONS.map((migration) =>
      migration.id === 2 ? { ...migration, sql: 'SELECT 1;' } : migration,
    )

    expect(() => new Migrator(database, tampered, clock).migrate()).toThrow(/checksum drift/)
  })

  it('rejects a database that contains an unknown applied migration', () => {
    const migrator = new Migrator(database, KERNEL_MIGRATIONS, clock)
    migrator.ensureTable()
    database.run(
      'INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      [99, 'ghost', 'deadbeef', clock.nowIso()],
    )

    expect(() => migrator.migrate()).toThrow(/unknown migration id 99/)
  })

  it('rejects a renamed migration whose fingerprint no longer matches', () => {
    const migrator = new Migrator(database, KERNEL_MIGRATIONS, clock)
    migrator.ensureTable()
    database.run(
      'INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      [1, 'renamed', 'deadbeef', clock.nowIso()],
    )

    expect(() => migrator.migrate()).toThrow(/checksum drift/)
  })
})
