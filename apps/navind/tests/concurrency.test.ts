import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../src/adapters/sqlite-database.js'
import { SystemClock } from '../src/adapters/system-clock.js'
import { KERNEL_MIGRATIONS } from '../src/db/migrations.js'
import { Migrator } from '../src/db/migrator.js'
import { APP_ROOT } from './support/spawn-server.js'
import { createTempDir, removeTempDir } from './support/test-helpers.js'

const WRITER_FIXTURE = fileURLToPath(new URL('./fixtures/concurrent-writer.ts', import.meta.url))

function runWriter(prefix: string, databasePath: string, count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', WRITER_FIXTURE], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        NAVIND_TEST_DB: databasePath,
        NAVIND_TEST_PREFIX: prefix,
        NAVIND_TEST_COUNT: String(count),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`writer "${prefix}" exited with code ${code}: ${stderr}`))
      }
    })
  })
}

describe('SQLite concurrency', () => {
  let dir: string
  let databasePath: string

  beforeEach(() => {
    dir = createTempDir()
    databasePath = join(dir, 'navin.db')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  it('serializes concurrent writes from multiple processes without losing rows', async () => {
    const setup = SqliteDatabase.open({ path: databasePath })
    new Migrator(setup, KERNEL_MIGRATIONS, new SystemClock()).migrate()
    setup.close()

    const writers = ['alpha', 'bravo', 'charlie', 'delta']
    const perWriter = 40

    await Promise.all(writers.map((prefix) => runWriter(prefix, databasePath, perWriter)))

    expect(existsSync(databasePath)).toBe(true)

    const database = SqliteDatabase.open({ path: databasePath })
    const total = database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM kernel_metadata',
    )?.count
    database.close()

    expect(total).toBe(writers.length * perWriter)
  })

  it('serves reads while a write transaction holds the lock', async () => {
    const setup = SqliteDatabase.open({ path: databasePath })
    new Migrator(setup, KERNEL_MIGRATIONS, new SystemClock()).migrate()
    setup.close()

    const writer = SqliteDatabase.open({ path: databasePath, timeoutMs: 5000 })
    const reader = SqliteDatabase.open({ path: databasePath })

    writer.transaction((tx) => {
      tx.run('INSERT INTO kernel_metadata (key, value, updated_at) VALUES (?, ?, ?)', [
        'lock:held',
        '1',
        '2026-10-01T00:00:00.000Z',
      ])
      // A WAL reader must still see the last committed snapshot.
      const visible = reader.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM kernel_metadata',
      )?.count
      expect(visible).toBe(0)
    })

    writer.close()
    reader.close()
  })
})
