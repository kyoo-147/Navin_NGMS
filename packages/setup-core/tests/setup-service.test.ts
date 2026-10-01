import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SetupService,
  SetupCommandError,
  type SetupDatabase,
  type SqlValue,
  type SetupClock,
} from '../src/index.js'

class MemoryClock implements SetupClock {
  private current = 1775000000000

  nowIso(): string {
    return new Date(this.current).toISOString()
  }

  advance(ms: number): void {
    this.current += ms
  }
}

class SqliteDatabaseSyncAdapter implements SetupDatabase {
  private depth = 0
  constructor(private readonly connection: DatabaseSync) {}

  exec(sql: string): void {
    this.connection.exec(sql)
  }

  run(
    sql: string,
    params: readonly SqlValue[] = [],
  ): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.connection.prepare(sql)
    const result = stmt.run(...(params as (null | number | bigint | string | Uint8Array)[]))
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid }
  }

  get<T>(sql: string, params: readonly SqlValue[] = []): T | undefined {
    const stmt = this.connection.prepare(sql)
    return stmt.get(...(params as (null | number | bigint | string | Uint8Array)[])) as
      T | undefined
  }

  all<T>(sql: string, params: readonly SqlValue[] = []): T[] {
    const stmt = this.connection.prepare(sql)
    return stmt.all(...(params as (null | number | bigint | string | Uint8Array)[])) as T[]
  }

  transaction<T>(fn: (database: SetupDatabase) => T): T {
    if (this.depth > 0) return fn(this)
    this.depth += 1
    this.exec('BEGIN')
    try {
      const result = fn(this)
      this.exec('COMMIT')
      return result
    } catch (error) {
      this.exec('ROLLBACK')
      throw error
    } finally {
      this.depth -= 1
    }
  }
}

function createTestHarness(dbPath?: string) {
  const path = dbPath ?? ':memory:'
  const connection = new DatabaseSync(path, { enableForeignKeyConstraints: true })
  const db = new SqliteDatabaseSyncAdapter(connection)
  const clock = new MemoryClock()
  const service = new SetupService(db, clock)
  return { connection, db, clock, service, path }
}

describe('SetupService & SetupStore', () => {
  it('creates typed setup sessions with deterministic IDs and initial blocks', () => {
    const { service } = createTestHarness()
    const session = service.create({ title: 'Primary Mailnode Setup' })

    expect(session.id).toMatch(/^set_[a-f0-9]{32}$/)
    expect(session.title).toBe('Primary Mailnode Setup')
    expect(session.currentStage).toBe('DISCOVER')
    expect(session.status).toBe('active')
    expect(session.blocks).toHaveLength(6)

    const kinds = session.blocks.map((b) => b.kind)
    expect(kinds).toEqual(['discovery', 'plan', 'diff', 'approval', 'action', 'verification'])

    // First block is ready, rest are pending
    expect(session.blocks[0]?.status).toBe('ready')
    expect(session.blocks[1]?.status).toBe('pending')
  })

  it('enforces dependency chain across discover -> plan -> diff -> approve -> apply -> verify', () => {
    const { service } = createTestHarness()
    const session = service.create({ title: 'Ordered Deployment' })

    // Cannot run plan before discover
    expect(() => service.run(session.id, 'plan')).toThrowError(SetupCommandError)
    expect(() => service.run(session.id, 'apply')).toThrowError(SetupCommandError)

    // Complete discover
    const s1 = service.run(session.id, 'discover')
    expect(s1.blocks[0]?.status).toBe('passed')
    expect(s1.blocks[0]?.value).toBeDefined()
    expect(s1.blocks[0]?.evidenceIds?.length).toBeGreaterThan(0)

    // Complete plan
    const s2 = service.run(session.id, 'plan')
    expect(s2.blocks[1]?.status).toBe('passed')

    // Complete diff
    const s3 = service.run(session.id, 'diff')
    expect(s3.blocks[2]?.status).toBe('passed')

    // Complete approve
    const s4 = service.run(session.id, 'approve')
    expect(s4.blocks[3]?.status).toBe('passed')

    // Complete apply
    const s5 = service.run(session.id, 'apply')
    expect(s5.blocks[4]?.status).toBe('passed')

    // Complete verify
    const s6 = service.run(session.id, 'verify')
    expect(s6.blocks[5]?.status).toBe('passed')
    expect(s6.status).toBe('completed')
    expect(s6.currentStage).toBe('READY')
  })

  it('persists data across SQLite restart and resumes idempotently', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'navin-setup-test-'))
    const dbPath = join(tempDir, 'setup-restart.db')

    try {
      const h1 = createTestHarness(dbPath)
      const session = h1.service.create({ title: 'Restart Persistence Test' })
      h1.service.run(session.id, 'discover')
      h1.service.run(session.id, 'plan')
      h1.service.run(session.id, 'diff')
      h1.service.run(session.id, 'approve')
      h1.service.run(session.id, 'apply')
      h1.connection.close()

      // Reopen on same database file
      const connection2 = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true })
      const db2 = new SqliteDatabaseSyncAdapter(connection2)
      const service2 = new SetupService(db2, h1.clock)

      const recovered = service2.get(session.id)
      expect(recovered.id).toBe(session.id)
      expect(recovered.title).toBe(session.title)
      expect(recovered.blocks[4]?.status).toBe('passed') // apply block
      expect(recovered.blocks[5]?.status).toBe('pending') // verify block

      // Resuming is idempotent
      const resumed = service2.resume(session.id)
      expect(resumed.id).toBe(session.id)
      expect(resumed.blocks[4]?.status).toBe('passed')

      // Complete remaining block
      const final = service2.run(session.id, 'verify')
      expect(final.status).toBe('completed')

      // Further resume does not alter completed status
      const resumedFinal = service2.resume(session.id)
      expect(resumedFinal.status).toBe('completed')

      connection2.close()
    } finally {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('fails closed on Tier 3 destructive operations without typed confirmation and recent auth', () => {
    const { service, clock } = createTestHarness()
    const session = service.create({ title: 'Destructive Cutover Setup', destructive: true })

    service.run(session.id, 'discover')
    service.run(session.id, 'plan')
    service.run(session.id, 'diff')

    const approveBlock = session.blocks.find((b) => b.kind === 'approval')
    expect(approveBlock?.risk).toBe('destructive')

    const expectedPhrase = `confirm ${session.id}`

    // 1. Fails closed when no confirmation provided
    expect(() => service.run(session.id, 'approve')).toThrowError(
      /Tier 3 approve requires typed confirmation/,
    )

    // 2. Fails closed when --yes / force is used without confirmation
    expect(() => service.run(session.id, 'approve', { force: true })).toThrowError(
      /never bypassed by force\/yes/,
    )

    // 3. Fails closed when confirmation phrase is incorrect
    expect(() => service.run(session.id, 'approve', { confirmation: 'yes' })).toThrowError(
      /Tier 3 approve requires typed confirmation/,
    )

    // 4. Fails closed when sessionAssurance is omitted entirely
    expect(() =>
      service.run(session.id, 'approve', {
        confirmation: expectedPhrase,
      }),
    ).toThrowError(/Tier 3 operation requires recent authentication/)

    // 5. Fails closed when auth assurance is too low or stale
    clock.advance(15 * 60 * 1000) // 15 mins elapsed
    expect(() =>
      service.run(session.id, 'approve', {
        confirmation: expectedPhrase,
        sessionAssurance: {
          assuranceLevel: 'password_only',
          lastAuthenticatedAt: new Date(1775000000000).toISOString(),
        },
      }),
    ).toThrowError(/Tier 3 operation requires recent authentication/)

    // 6. Succeeds when typed confirmation and recent auth are both valid
    const passed = service.run(session.id, 'approve', {
      confirmation: expectedPhrase,
      sessionAssurance: {
        assuranceLevel: 'mfa_verified',
        lastAuthenticatedAt: clock.nowIso(),
      },
    })
    expect(passed.blocks.find((b) => b.kind === 'approval')?.status).toBe('passed')

    // 7. Apply block also requires sessionAssurance unconditionally
    expect(() =>
      service.run(session.id, 'apply', {
        confirmation: expectedPhrase,
      }),
    ).toThrowError(/Tier 3 operation requires recent authentication/)
  })

  it('publishes SSE events with monotonic sequence numbers and allows replaying since cursor', () => {
    const { service } = createTestHarness()
    const session = service.create({ title: 'Event Stream Test' })

    const events: string[] = []
    const unsub = service.subscribe(session.id, (evt) => {
      events.push(evt.kind)
    })

    service.run(session.id, 'discover')
    service.run(session.id, 'plan')
    unsub()

    expect(events.length).toBeGreaterThanOrEqual(4) // block and session update events

    // Replay since cursor 0
    const allStored = service.eventsSince(session.id, 0)
    expect(allStored.length).toBeGreaterThanOrEqual(4)
    expect(allStored[0]?.seq).toBe(1)
    expect(allStored[1]?.seq).toBe(2)

    // Replay since cursor 2
    const tail = service.eventsSince(session.id, 2)
    expect(tail.length).toBe(allStored.length - 2)
  })
})
