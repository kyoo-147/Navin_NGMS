import { ActionCoreError } from '../errors.js'
import { sha256Digest } from '../json.js'
import type { SqliteDatabase } from './database.js'

export interface Migration {
  version: number
  name: string
  statements: string[]
}

const APPEND_ONLY_TABLES = ['events', 'evidence', 'audit_records'] as const

function appendOnlyTriggers(table: string): string[] {
  return [
    `CREATE TRIGGER ${table}_append_only_update BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;`,
    `CREATE TRIGGER ${table}_append_only_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;`,
  ]
}

const INITIAL_SCHEMA: string[] = [
  `CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    surface TEXT NOT NULL,
    plan_id TEXT,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    risk_tier INTEGER NOT NULL CHECK (risk_tier BETWEEN 0 AND 3),
    parameters TEXT NOT NULL,
    diff TEXT,
    verification TEXT,
    can_rollback INTEGER NOT NULL DEFAULT 0,
    requested_by TEXT NOT NULL,
    approval_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX actions_status_idx ON actions(status)`,
  `CREATE INDEX actions_created_idx ON actions(created_at)`,
  `CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    action_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    risk_tier INTEGER NOT NULL CHECK (risk_tier BETWEEN 0 AND 3),
    confirmation_type TEXT NOT NULL,
    typed_phrase TEXT,
    requires_recent_auth INTEGER NOT NULL DEFAULT 0,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL,
    decision TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX approvals_action_idx ON approvals(action_id)`,
  `CREATE INDEX approvals_status_idx ON approvals(status)`,
  `CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    surface TEXT NOT NULL,
    status TEXT NOT NULL,
    idempotency_key TEXT,
    cancellable INTEGER NOT NULL DEFAULT 0,
    resumable INTEGER NOT NULL DEFAULT 0,
    progress TEXT,
    payload TEXT NOT NULL,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    revision INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE UNIQUE INDEX jobs_idempotency_key_uq ON jobs(idempotency_key)
     WHERE idempotency_key IS NOT NULL`,
  `CREATE INDEX jobs_status_idx ON jobs(status)`,
  `CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    api_version TEXT NOT NULL,
    kind TEXT NOT NULL,
    channel TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    job_id TEXT,
    action_id TEXT,
    session_id TEXT,
    status TEXT,
    progress TEXT,
    data TEXT,
    metadata TEXT
  )`,
  `CREATE INDEX events_channel_seq_idx ON events(channel, seq)`,
  `CREATE INDEX events_job_idx ON events(job_id)`,
  `CREATE INDEX events_action_idx ON events(action_id)`,
  `CREATE TABLE evidence (
    id TEXT PRIMARY KEY,
    check_type TEXT NOT NULL,
    status TEXT NOT NULL,
    target TEXT NOT NULL,
    collector TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    details TEXT NOT NULL,
    digest TEXT,
    raw_output_redacted TEXT
  )`,
  `CREATE INDEX evidence_check_idx ON evidence(check_type)`,
  `CREATE INDEX evidence_observed_idx ON evidence(observed_at)`,
  `CREATE TABLE audit_records (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action_name TEXT NOT NULL,
    target TEXT NOT NULL,
    outcome TEXT NOT NULL,
    risk_tier INTEGER NOT NULL,
    approval_id TEXT,
    details TEXT,
    timestamp TEXT NOT NULL
  )`,
  `CREATE INDEX audit_timestamp_idx ON audit_records(timestamp)`,
  `CREATE INDEX audit_action_idx ON audit_records(action_name)`,
  `CREATE TABLE idempotency (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope, key)
  )`,
  ...APPEND_ONLY_TABLES.flatMap(appendOnlyTriggers),
]

/**
 * Execution attempts record the durable pre-dispatch reservation and the eventual
 * outcome. A row still in `dispatched` after a restart means the external side
 * effect may have happened, so recovery must surface an unknown outcome instead
 * of blindly allowing a retry.
 */
const ATTEMPT_SCHEMA: string[] = [
  `CREATE TABLE action_attempts (
    id TEXT PRIMARY KEY,
    action_id TEXT NOT NULL,
    idempotency_key TEXT,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    dispatched_at TEXT,
    finished_at TEXT,
    detail TEXT
  )`,
  `CREATE INDEX action_attempts_action_idx ON action_attempts(action_id, attempt)`,
  `CREATE UNIQUE INDEX action_attempts_idempotency_uq ON action_attempts(idempotency_key)
     WHERE idempotency_key IS NOT NULL`,
]

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_action_job_event_evidence_ledger',
    statements: INITIAL_SCHEMA,
  },
  {
    version: 2,
    name: 'action_execution_attempts',
    statements: ATTEMPT_SCHEMA,
  },
  {
    version: 3,
    name: 'stable_external_action_idempotency_keys',
    statements: [
      'ALTER TABLE action_attempts ADD COLUMN external_idempotency_key TEXT',
      "UPDATE action_attempts SET external_idempotency_key = 'navin-action:' || action_id WHERE external_idempotency_key IS NULL",
      'CREATE INDEX action_attempts_external_key_idx ON action_attempts(external_idempotency_key)',
    ],
  },
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
)

function ensureChecksumColumn(db: SqliteDatabase): boolean {
  const columns = db.prepare('PRAGMA table_info(schema_migrations)').all() as unknown as Array<{
    name: string
  }>
  if (!columns.some((column) => column.name === 'checksum')) {
    db.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT')
    return true
  }
  return false
}

/**
 * Deterministic checksum over a migration's identity and statements. Any change to
 * an already-applied migration is treated as drift and refuses to open the database.
 */
export function computeMigrationChecksum(migration: Migration): string {
  return sha256Digest({
    version: migration.version,
    name: migration.name,
    statements: migration.statements,
  })
}

export function runMigrations(db: SqliteDatabase, now: () => string): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const legacyChecksums = ensureChecksumColumn(db)

  const appliedRows = db
    .prepare('SELECT version, name, checksum FROM schema_migrations')
    .all() as unknown as Array<{ version: number | bigint; name: string; checksum: string | null }>
  const knownByVersion = new Map(MIGRATIONS.map((migration) => [migration.version, migration]))
  if (legacyChecksums) {
    for (const row of appliedRows) {
      const known = knownByVersion.get(Number(row.version))
      if (known !== undefined && row.checksum === null) {
        const checksum = computeMigrationChecksum(known)
        db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = ?').run(
          checksum,
          Number(row.version),
        )
        row.checksum = checksum
      }
    }
  }

  for (const row of appliedRows) {
    const version = Number(row.version)
    const known = knownByVersion.get(version)
    if (known === undefined) {
      throw new ActionCoreError(
        'CONFLICT',
        `Unknown applied migration v${version} (${row.name}); refusing to open the database`,
        { details: { version, name: row.name } },
      )
    }
    const expected = computeMigrationChecksum(known)
    if (row.checksum !== expected) {
      throw new ActionCoreError(
        'CONFLICT',
        `Migration checksum drift for v${version} (${known.name}); refusing to open the database`,
        { details: { version, name: known.name, expected, actual: row.checksum } },
      )
    }
  }

  const applied = new Set(appliedRows.map((row) => Number(row.version)))
  let current = 0
  for (const migration of MIGRATIONS) {
    current = Math.max(current, migration.version)
    if (migration.version > 1 && !applied.has(migration.version - 1)) {
      throw new ActionCoreError(
        'CONFLICT',
        `Migration v${migration.version} is missing its predecessor; refusing to open the database`,
        { details: { version: migration.version, predecessor: migration.version - 1 } },
      )
    }
    if (applied.has(migration.version)) {
      continue
    }
    db.transaction(() => {
      for (const statement of migration.statements) {
        db.exec(statement)
      }
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(migration.version, migration.name, computeMigrationChecksum(migration), now())
      applied.add(migration.version)
    })
  }
  return current
}
