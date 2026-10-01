import { DatabaseSync, type StatementSync } from 'node:sqlite'

import { ActionCoreError } from '../errors.js'

export interface OpenDatabaseOptions {
  path: string
  /** Enable WAL journaling. Ignored for in-memory databases. Defaults to true. */
  wal?: boolean
  /** How long SQLite waits on a busy lock before returning SQLITE_BUSY. */
  busyTimeoutMs?: number
}

const MEMORY_PATH = ':memory:'

/**
 * Thin, synchronous SQLite wrapper used by every ledger store.
 *
 * Design constraints:
 * - One connection per process (SQLite WAL supports concurrent readers + one writer).
 * - `BEGIN IMMEDIATE` serialises writers so optimistic revision checks are reliable.
 * - Transactions are re-entrant via SAVEPOINTs, which lets services compose ledger calls.
 */
export class SqliteDatabase {
  readonly path: string
  private readonly handle: DatabaseSync
  private transactionActive = false
  private savepointCounter = 0
  private closed = false
  private afterCommitQueue: Array<() => void> = []

  private constructor(path: string, handle: DatabaseSync) {
    this.path = path
    this.handle = handle
  }

  static open(options: OpenDatabaseOptions): SqliteDatabase {
    const { path, busyTimeoutMs = 5000 } = options
    const inMemory = path === MEMORY_PATH
    const wal = (options.wal ?? true) && !inMemory

    let handle: DatabaseSync
    try {
      handle = new DatabaseSync(path)
    } catch (error) {
      throw new ActionCoreError('INTERNAL_ERROR', `Failed to open SQLite database at ${path}`, {
        cause: error,
        details: { path },
      })
    }

    const database = new SqliteDatabase(path, handle)
    handle.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`)
    handle.exec('PRAGMA foreign_keys = ON')
    if (wal) {
      handle.exec('PRAGMA journal_mode = WAL')
      handle.exec('PRAGMA synchronous = NORMAL')
    }
    return database
  }

  get isOpen(): boolean {
    return !this.closed && this.handle.isOpen
  }

  get journalMode(): string {
    const row = this.handle.prepare('PRAGMA journal_mode').get() as
      { journal_mode?: unknown } | undefined
    return row?.journal_mode === undefined ? '' : String(row.journal_mode)
  }

  exec(sql: string): void {
    this.handle.exec(sql)
  }

  prepare(sql: string): StatementSync {
    return this.handle.prepare(sql)
  }

  transaction<T>(work: () => T): T {
    if (this.closed) {
      throw new ActionCoreError('INTERNAL_ERROR', 'Database is closed')
    }
    if (this.transactionActive) {
      return this.savepoint(work)
    }
    this.handle.exec('BEGIN IMMEDIATE')
    this.transactionActive = true
    try {
      const result = work()
      this.handle.exec('COMMIT')
      return result
    } catch (error) {
      this.afterCommitQueue = []
      try {
        this.handle.exec('ROLLBACK')
      } catch {
        // Ignore rollback failures; the original error is what matters.
      }
      throw error
    } finally {
      this.transactionActive = false
      this.flushAfterCommit()
    }
  }

  /**
   * Runs `callback` after the current transaction commits, or immediately when
   * no transaction is active. Callbacks queued inside a rolled-back transaction
   * are discarded. Used to publish events only for durable writes.
   */
  afterCommit(callback: () => void): void {
    if (this.transactionActive) {
      this.afterCommitQueue.push(callback)
      return
    }
    callback()
  }

  private flushAfterCommit(): void {
    if (this.afterCommitQueue.length === 0) {
      return
    }
    const queued = this.afterCommitQueue
    this.afterCommitQueue = []
    for (const callback of queued) {
      try {
        callback()
      } catch {
        // Notification listeners must never corrupt committed state.
      }
    }
  }

  private savepoint<T>(work: () => T): T {
    this.savepointCounter += 1
    const name = `navin_sp_${this.savepointCounter}`
    // Callbacks queued inside this savepoint must be discarded if it rolls back,
    // otherwise a reverted nested write would still emit a live notification.
    const queueMark = this.afterCommitQueue.length
    this.handle.exec(`SAVEPOINT ${name}`)
    try {
      const result = work()
      this.handle.exec(`RELEASE ${name}`)
      return result
    } catch (error) {
      this.handle.exec(`ROLLBACK TO ${name}`)
      this.handle.exec(`RELEASE ${name}`)
      this.afterCommitQueue.length = queueMark
      throw error
    }
  }

  checkpoint(mode: 'PASSIVE' | 'FULL' | 'TRUNCATE' = 'TRUNCATE'): void {
    this.handle.exec(`PRAGMA wal_checkpoint(${mode})`)
  }

  integrityCheck(): string {
    const row = this.handle.prepare('PRAGMA integrity_check').get() as
      { integrity_check?: unknown } | undefined
    return row?.integrity_check === undefined ? 'unknown' : String(row.integrity_check)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.handle.close()
  }
}
