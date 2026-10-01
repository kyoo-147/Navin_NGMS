import { DatabaseSync } from 'node:sqlite'
import type {
  Database,
  DatabaseFactory,
  DatabaseOpenOptions,
  RunResult,
  SqlValue,
} from '../ports/database.js'

const DEFAULT_BUSY_TIMEOUT_MS = 5000

/**
 * SQLite implementation of the {@link Database} port.
 *
 * The database runs in WAL mode so readers are never blocked by the single
 * writer, which is what makes the concurrent-process tests meaningful.
 */
export class SqliteDatabase implements Database {
  private readonly connection: DatabaseSync
  private readonly databasePath: string
  private readonly busyTimeoutMs: number
  private open = true
  private transactionDepth = 0

  private constructor(connection: DatabaseSync, path: string, busyTimeoutMs: number) {
    this.connection = connection
    this.databasePath = path
    this.busyTimeoutMs = busyTimeoutMs
  }

  static open(options: DatabaseOpenOptions): SqliteDatabase {
    const busyTimeoutMs = options.timeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS
    const connection = new DatabaseSync(options.path, {
      readOnly: options.readonly ?? false,
      enableForeignKeyConstraints: true,
    })
    const database = new SqliteDatabase(connection, options.path, busyTimeoutMs)
    database.configure(options.readonly ?? false)
    return database
  }

  get path(): string {
    return this.databasePath
  }

  get isOpen(): boolean {
    return this.open
  }

  exec(sql: string): void {
    this.assertOpen()
    this.connection.exec(sql)
  }

  run(sql: string, params: readonly SqlValue[] = []): RunResult {
    this.assertOpen()
    const statement = this.connection.prepare(sql)
    const result = statement.run(...params)
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    }
  }

  get<T>(sql: string, params: readonly SqlValue[] = []): T | undefined {
    this.assertOpen()
    const statement = this.connection.prepare(sql)
    return statement.get(...params) as unknown as T | undefined
  }

  all<T>(sql: string, params: readonly SqlValue[] = []): T[] {
    this.assertOpen()
    const statement = this.connection.prepare(sql)
    return statement.all(...params) as unknown as T[]
  }

  transaction<T>(fn: (database: Database) => T): T {
    this.assertOpen()

    if (this.transactionDepth > 0) {
      this.transactionDepth += 1
      try {
        return fn(this)
      } finally {
        this.transactionDepth -= 1
      }
    }

    this.connection.exec('BEGIN IMMEDIATE')
    this.transactionDepth = 1
    try {
      const result = fn(this)
      this.connection.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.connection.exec('ROLLBACK')
      } catch {
        // The transaction may already have been rolled back by SQLite.
      }
      throw error
    } finally {
      this.transactionDepth = 0
    }
  }

  close(): void {
    if (!this.open) {
      return
    }
    this.open = false
    this.connection.close()
  }

  /** Reads a pragma value; used to assert journal mode in tests. */
  readPragma(name: string): string | number | undefined {
    this.assertOpen()
    const row = this.connection.prepare(`PRAGMA ${name}`).get() as
      Record<string, string | number> | undefined
    if (!row) {
      return undefined
    }
    const value = Object.values(row)[0]
    return value
  }

  private configure(readonly: boolean): void {
    this.connection.exec('PRAGMA foreign_keys = ON')
    this.connection.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`)
    if (!readonly) {
      this.connection.exec('PRAGMA journal_mode = WAL')
      this.connection.exec('PRAGMA synchronous = NORMAL')
    }
  }

  private assertOpen(): void {
    if (!this.open) {
      throw new Error(`Database at ${this.databasePath} is closed`)
    }
  }
}

export class SqliteDatabaseFactory implements DatabaseFactory {
  open(options: DatabaseOpenOptions): Database {
    return SqliteDatabase.open(options)
  }
}
