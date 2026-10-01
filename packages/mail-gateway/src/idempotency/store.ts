import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { GatewayError, isGatewayError } from '../errors.js'

export type IdempotencyStatus = 'pending' | 'succeeded' | 'needs_attention'

export interface IdempotencyRecord {
  scope: string
  key: string
  fingerprint: string
  status: IdempotencyStatus
  response?: unknown
  createdAt: number
  expiresAt: number
}

export interface IdempotencyStore {
  get(scope: string, key: string): Promise<IdempotencyRecord | null>
  /** Atomically reserve a key. Null means this caller owns the reservation. */
  reserve(record: IdempotencyRecord): Promise<IdempotencyRecord | null>
  set(record: IdempotencyRecord): Promise<void>
  delete(scope: string, key: string): Promise<void>
}

export interface IdempotentOutcome<T> {
  value: T
  replayed: boolean
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
}

export interface RunIdempotentOptions<T> {
  store: IdempotencyStore
  scope: string
  key: string
  fingerprint: string
  ttlMs?: number
  now?: () => number
  produce: () => Promise<T>
}

function needsAttention(record: IdempotencyRecord): GatewayError {
  return new GatewayError({
    code: 'ACTION_BLOCKED',
    message: 'The idempotent operation has an unknown upstream outcome and needs attention',
    retryable: false,
    details: { state: 'needs_attention', scope: record.scope, key: record.key },
  })
}

function isUnknownOutcome(error: unknown): boolean {
  if (!isGatewayError(error)) return true
  const reason = error.details['reason']
  return (
    reason === 'timeout' ||
    reason === 'aborted' ||
    reason === 'network' ||
    (error.code === 'SERVICE_UNAVAILABLE' && error.retryable)
  )
}

function assertReusable(
  existing: IdempotencyRecord,
  scope: string,
  key: string,
  requestFingerprint: string,
): IdempotentOutcome<never> | null {
  if (existing.fingerprint !== requestFingerprint) {
    throw new GatewayError({
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Idempotency key was reused with a different request payload',
      httpStatus: 409,
      details: { scope, key },
    })
  }
  if (existing.status === 'succeeded' && existing.response !== undefined)
    return { value: existing.response as never, replayed: true }
  throw needsAttention(existing)
}

/**
 * Reserve before producing, then persist only a successful result. A timeout,
 * abort, network failure, or an unclassified producer failure leaves a durable
 * needs_attention record rather than falsely caching success or silently
 * running the mutation a second time.
 */
export async function runIdempotent<T>(
  options: RunIdempotentOptions<T>,
): Promise<IdempotentOutcome<T>> {
  const now = options.now ?? Date.now
  const createdAt = now()
  const pending: IdempotencyRecord = {
    scope: options.scope,
    key: options.key,
    fingerprint: options.fingerprint,
    status: 'pending',
    createdAt,
    expiresAt: createdAt + (options.ttlMs ?? 24 * 60 * 60 * 1000),
  }
  const existing = await options.store.get(options.scope, options.key)
  if (existing && existing.expiresAt > now())
    return assertReusable(
      existing,
      options.scope,
      options.key,
      options.fingerprint,
    ) as IdempotentOutcome<T>

  const raced = await options.store.reserve(pending)
  if (raced)
    return assertReusable(
      raced,
      options.scope,
      options.key,
      options.fingerprint,
    ) as IdempotentOutcome<T>

  try {
    const value = await options.produce()
    await options.store.set({ ...pending, status: 'succeeded', response: value })
    return { value, replayed: false }
  } catch (error) {
    if (isUnknownOutcome(error)) {
      await options.store.set({ ...pending, status: 'needs_attention' })
      throw needsAttention(pending)
    }
    await options.store.delete(options.scope, options.key)
    throw error
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>()
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: { maxEntries?: number; now?: () => number } = {}) {
    this.maxEntries = options.maxEntries ?? 10_000
    this.now = options.now ?? Date.now
  }

  private composite(scope: string, key: string): string {
    return `${scope}\u0000${key}`
  }

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const composite = this.composite(scope, key)
    const record = this.records.get(composite)
    if (!record) return null
    if (record.expiresAt <= this.now()) {
      this.records.delete(composite)
      return null
    }
    return record
  }

  async reserve(record: IdempotencyRecord): Promise<IdempotencyRecord | null> {
    const composite = this.composite(record.scope, record.key)
    const existing = await this.get(record.scope, record.key)
    if (existing) return existing
    if (this.records.size >= this.maxEntries) {
      this.evictExpired()
      if (this.records.size >= this.maxEntries) {
        const oldest = this.records.keys().next()
        if (!oldest.done) this.records.delete(oldest.value)
      }
    }
    this.records.set(composite, record)
    return null
  }

  async set(record: IdempotencyRecord): Promise<void> {
    this.records.set(this.composite(record.scope, record.key), record)
  }

  async delete(scope: string, key: string): Promise<void> {
    this.records.delete(this.composite(scope, key))
  }

  private evictExpired(): void {
    const now = this.now()
    for (const [composite, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(composite)
    }
  }
}

const SQLITE_SCHEMA_VERSION = 1
const SQLITE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mail_gateway_idempotency (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'needs_attention')),
  response_json TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (scope, key)
);
`
const SQLITE_SCHEMA_CHECKSUM = createHash('sha256').update(SQLITE_SCHEMA_SQL).digest('hex')
const SQLITE_COLUMNS = new Set([
  'scope',
  'key',
  'fingerprint',
  'status',
  'response_json',
  'created_at',
  'expires_at',
])

export interface SqliteIdempotencyStoreOptions {
  filename: string
  now?: () => number
  busyTimeoutMs?: number
}

/**
 * Durable SQLite-backed idempotency store. Reservations are committed before
 * the caller performs an upstream mutation. WAL plus BEGIN IMMEDIATE makes
 * reserve atomic across processes using the same database file.
 */
export class SqliteIdempotencyStore implements IdempotencyStore {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private closed = false

  constructor(options: SqliteIdempotencyStoreOptions) {
    if (!options.filename) throw new Error('SQLite idempotency filename is required')
    if (options.filename !== ':memory:') mkdirSync(dirname(options.filename), { recursive: true })
    this.db = new DatabaseSync(options.filename)
    this.now = options.now ?? Date.now
    try {
      this.db.exec(`PRAGMA journal_mode = WAL;`)
      this.db.exec(`PRAGMA synchronous = FULL;`)
      this.db.exec(`PRAGMA foreign_keys = ON;`)
      this.db.exec(
        `PRAGMA busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))};`,
      )
      this.migrateAndVerify()
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('SQLite idempotency store is closed')
  }

  private migrateAndVerify(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mail_gateway_schema_migrations (
        version INTEGER PRIMARY KEY,
        checksum TEXT NOT NULL
      );
    `)
    this.db.exec(SQLITE_SCHEMA_SQL)
    const columns = this.db.prepare('PRAGMA table_info(mail_gateway_idempotency)').all() as Array<{
      name?: unknown
    }>
    const names = new Set(
      columns
        .map((column) => column.name)
        .filter((name): name is string => typeof name === 'string'),
    )
    for (const column of SQLITE_COLUMNS) {
      if (!names.has(column))
        throw new Error(`SQLite idempotency schema is missing column ${column}`)
    }

    const migration = this.db
      .prepare('SELECT checksum FROM mail_gateway_schema_migrations WHERE version = ?')
      .get(SQLITE_SCHEMA_VERSION) as { checksum?: unknown } | undefined
    if (migration && migration.checksum !== SQLITE_SCHEMA_CHECKSUM)
      throw new Error('SQLite idempotency schema checksum mismatch')
    if (!migration) {
      this.db
        .prepare('INSERT INTO mail_gateway_schema_migrations(version, checksum) VALUES (?, ?)')
        .run(SQLITE_SCHEMA_VERSION, SQLITE_SCHEMA_CHECKSUM)
    }
  }

  private read(scope: string, key: string): IdempotencyRecord | null {
    const row = this.db
      .prepare(
        'SELECT scope, key, fingerprint, status, response_json, created_at, expires_at FROM mail_gateway_idempotency WHERE scope = ? AND key = ?',
      )
      .get(scope, key) as Record<string, unknown> | undefined
    if (!row) return null
    const status = row['status']
    if (status !== 'pending' && status !== 'succeeded' && status !== 'needs_attention')
      throw new Error('SQLite idempotency record has an invalid status')
    const record: IdempotencyRecord = {
      scope: String(row['scope']),
      key: String(row['key']),
      fingerprint: String(row['fingerprint']),
      status,
      createdAt: Number(row['created_at']),
      expiresAt: Number(row['expires_at']),
    }
    if (typeof row['response_json'] === 'string') {
      try {
        record.response = JSON.parse(row['response_json']) as unknown
      } catch {
        throw new Error('SQLite idempotency response JSON is malformed')
      }
    }
    return record
  }

  private removeExpired(scope: string, key: string): void {
    this.db
      .prepare(
        'DELETE FROM mail_gateway_idempotency WHERE scope = ? AND key = ? AND expires_at <= ?',
      )
      .run(scope, key, this.now())
  }

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    this.ensureOpen()
    const record = this.read(scope, key)
    if (!record) return null
    if (record.expiresAt <= this.now()) {
      this.removeExpired(scope, key)
      return null
    }
    return record
  }

  async reserve(record: IdempotencyRecord): Promise<IdempotencyRecord | null> {
    this.ensureOpen()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.read(record.scope, record.key)
      if (existing && existing.expiresAt <= this.now()) {
        this.db
          .prepare('DELETE FROM mail_gateway_idempotency WHERE scope = ? AND key = ?')
          .run(record.scope, record.key)
      } else if (existing) {
        this.db.exec('COMMIT')
        return existing
      }
      this.db
        .prepare(
          'INSERT INTO mail_gateway_idempotency(scope, key, fingerprint, status, response_json, created_at, expires_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
        )
        .run(
          record.scope,
          record.key,
          record.fingerprint,
          record.status,
          record.createdAt,
          record.expiresAt,
        )
      this.db.exec('COMMIT')
      return null
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Preserve the original SQLite error.
      }
      throw error
    }
  }

  async set(record: IdempotencyRecord): Promise<void> {
    this.ensureOpen()
    let responseJson: string | null = null
    if (record.response !== undefined) {
      try {
        responseJson = JSON.stringify(record.response)
      } catch {
        throw new GatewayError({
          code: 'INTERNAL_ERROR',
          message: 'Idempotency response is not serializable',
        })
      }
    }
    const result = this.db
      .prepare(
        'UPDATE mail_gateway_idempotency SET fingerprint = ?, status = ?, response_json = ?, created_at = ?, expires_at = ? WHERE scope = ? AND key = ?',
      )
      .run(
        record.fingerprint,
        record.status,
        responseJson,
        record.createdAt,
        record.expiresAt,
        record.scope,
        record.key,
      )
    if (result.changes !== 1) throw new Error('SQLite idempotency reservation is missing')
  }

  async delete(scope: string, key: string): Promise<void> {
    this.ensureOpen()
    this.db
      .prepare('DELETE FROM mail_gateway_idempotency WHERE scope = ? AND key = ?')
      .run(scope, key)
  }

  close(): void {
    if (!this.closed) {
      this.db.close()
      this.closed = true
    }
  }
}
