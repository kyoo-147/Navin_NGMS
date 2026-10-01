export type SqlValue = null | number | bigint | string | Uint8Array

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

/**
 * Persistence port.
 *
 * The SQLite adapter is the production implementation; future domain packages
 * depend on this interface rather than on `node:sqlite` directly, which keeps
 * the storage engine replaceable and the domain testable.
 */
export interface Database {
  readonly path: string
  readonly isOpen: boolean
  exec(sql: string): void
  run(sql: string, params?: readonly SqlValue[]): RunResult
  get<T>(sql: string, params?: readonly SqlValue[]): T | undefined
  all<T>(sql: string, params?: readonly SqlValue[]): T[]
  /**
   * Run `fn` inside a single write transaction. A nested call joins the
   * enclosing transaction rather than opening a second one (SQLite does not
   * support nested `BEGIN`).
   */
  transaction<T>(fn: (database: Database) => T): T
  close(): void
}

export interface DatabaseOpenOptions {
  path: string
  /** Open read-only. Defaults to `false`. */
  readonly?: boolean
  /** Busy timeout in milliseconds before a locked database raises. */
  timeoutMs?: number
}

export interface DatabaseFactory {
  open(options: DatabaseOpenOptions): Database
}
