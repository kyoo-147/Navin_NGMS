import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore } from '../src/index.js'
import { createTempDir, openCore, removeTempDir } from './helpers.js'

const fixture = fileURLToPath(new URL('./fixtures/wal-crash-writer.mjs', import.meta.url))

describe('SQLite WAL crash recovery', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = createTempDir()
    dbPath = join(dir, 'crash.db')
    // Create the schema first so the crashing child only writes data.
    openCore(dir, 'crash.db').close()
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  it('recovers committed transactions and discards uncommitted work after hard crashes', () => {
    const committed = spawnSync(process.execPath, [fixture, dbPath, 'committed'], {
      encoding: 'utf8',
    })
    expect(committed.status).toBe(23)

    const uncommitted = spawnSync(process.execPath, [fixture, dbPath, 'uncommitted'], {
      encoding: 'utf8',
    })
    expect(uncommitted.status).toBe(24)

    const core = ActionCore.open({ path: dbPath })
    expect(core.db.integrityCheck()).toBe('ok')

    // Committed rows survived the crash.
    expect(core.actions.get('act_crash_committed')?.name).toBe('crash.test')
    const events = core.events.readSince(undefined, 0, 100)
    expect(events.some((entry) => entry.event.id === 'evt_crash_committed')).toBe(true)

    // The truncated transaction was rolled back.
    expect(core.actions.get('act_crash_uncommitted')).toBeUndefined()

    // The ledger keeps working after recovery.
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
    })
    expect(action.status).toBe('staged')
    core.close()
  })
})
