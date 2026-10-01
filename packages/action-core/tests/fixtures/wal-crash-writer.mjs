// Simulates a process crash against a real SQLite WAL database.
//
//   committed   -> writes a committed transaction, then exits abruptly (no close)
//   uncommitted -> starts a transaction, writes, then exits mid-transaction
//
// The parent reopens the database and asserts committed data survived and the
// uncommitted transaction was rolled back.
import { DatabaseSync } from 'node:sqlite'

const [, , dbPath, mode] = process.argv
if (dbPath === undefined || mode === undefined) {
  console.error('usage: wal-crash-writer.mjs <dbPath> <committed|uncommitted>')
  process.exit(2)
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA busy_timeout = 5000')

const timestamp = new Date().toISOString()

if (mode === 'committed') {
  db.exec('BEGIN IMMEDIATE')
  db.prepare(
    `INSERT INTO events (id, api_version, kind, channel, timestamp, data)
     VALUES (?, '1', 'job.progress', 'jobs', ?, ?)`,
  ).run('evt_crash_committed', timestamp, JSON.stringify({ note: 'survived crash' }))
  db.prepare(
    `INSERT INTO actions
       (id, name, surface, stage, status, risk_tier, parameters, can_rollback, requested_by, created_at, updated_at, revision)
     VALUES ('act_crash_committed', 'crash.test', 'control', 'discover', 'staged', 0, '{}', 0, 'usr_crash', ?, ?, 1)`,
  ).run(timestamp, timestamp)
  db.exec('COMMIT')
  // Abrupt exit: no close(), no checkpoint.
  process.exit(23)
} else {
  db.exec('BEGIN IMMEDIATE')
  db.prepare(
    `INSERT INTO actions
       (id, name, surface, stage, status, risk_tier, parameters, can_rollback, requested_by, created_at, updated_at, revision)
     VALUES ('act_crash_uncommitted', 'crash.test', 'control', 'discover', 'staged', 0, '{}', 0, 'usr_crash', ?, ?, 1)`,
  ).run(timestamp, timestamp)
  // Abrupt exit mid-transaction: the row must never be visible after recovery.
  process.exit(24)
}
