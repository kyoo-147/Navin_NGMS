import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore, MIGRATIONS, computeMigrationChecksum } from '../src/index.js'
import { createTempDir, openCore, removeTempDir } from './helpers.js'

describe('migration integrity', () => {
  let dir: string

  beforeEach(() => {
    dir = createTempDir()
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  it('records a deterministic checksum for every applied migration', () => {
    const core = openCore(dir)
    const rows = core.db
      .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
      .all()
    const version1 = MIGRATIONS.find((migration) => migration.version === 1)
    const version2 = MIGRATIONS.find((migration) => migration.version === 2)
    const version3 = MIGRATIONS.find((migration) => migration.version === 3)
    expect(version1).toBeDefined()
    expect(version2).toBeDefined()
    expect(version3).toBeDefined()
    expect(rows.find((row) => Number(row.version) === 1)?.checksum).toBe(
      computeMigrationChecksum(version1!),
    )
    expect(rows.find((row) => Number(row.version) === 2)?.checksum).toBe(
      computeMigrationChecksum(version2!),
    )
    expect(rows.find((row) => Number(row.version) === 3)?.checksum).toBe(
      computeMigrationChecksum(version3!),
    )
    expect(core.describe().schemaVersion).toBe(3)
    core.close()
  })

  it('refuses to open when an applied migration checksum drifted', () => {
    const dbPath = join(dir, 'drift.db')
    const core = ActionCore.open({ path: dbPath })
    core.db
      .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1')
      .run(`sha256:${'0'.repeat(64)}`)
    core.close()

    expect(() => ActionCore.open({ path: dbPath })).toThrowError(/checksum drift/)
  })

  it('refuses to open when an unknown migration is recorded', () => {
    const dbPath = join(dir, 'unknown.db')
    const core = ActionCore.open({ path: dbPath })
    core.db
      .prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      )
      .run(999, 'future-migration', `sha256:${'0'.repeat(64)}`, new Date().toISOString())
    core.close()

    expect(() => ActionCore.open({ path: dbPath })).toThrowError(/Unknown applied migration/)
  })
})
