import { DatabaseSync } from 'node:sqlite'

import type {
  InventoryItem,
  MigrationFailure,
  MigrationItemState,
  MigrationProtocol,
  MigrationRecord,
} from './types.js'

interface StoredMigrationRow {
  id: string
  protocol: MigrationProtocol
  status: MigrationRecord['status']
  baseline_cursor: string | null
  baseline_done: number
  delta_cursor: string | null
  cancellation_requested: number
  concurrency: number
  baseline_imported: number
  delta_imported: number
  reconciled: number
  deleted: number
  duplicate_prevented: number
  failures_json: string
}

interface StoredItemRow {
  item_key: string
  state: MigrationItemState
  target_id: string | null
}

export interface MigrationItemStateRecord {
  itemKey: string
  state: MigrationItemState
  targetId?: string
}

export function itemKey(item: InventoryItem): string {
  const identity =
    item.sourceUid === undefined ? (item.sourceId ?? item.messageId) : String(item.sourceUid)
  if (identity === undefined) {
    throw new Error('An inventory item must have sourceUid, sourceId, or messageId')
  }
  return `${item.sourceFolderId}:${identity}`
}

export class MigrationStore {
  private readonly db: DatabaseSync
  private closed = false

  private constructor(
    readonly path: string,
    db: DatabaseSync,
  ) {
    this.db = db
    this.db.exec('PRAGMA foreign_keys = ON')
    if (path !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = FULL')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        protocol TEXT NOT NULL,
        status TEXT NOT NULL,
        baseline_cursor TEXT,
        baseline_done INTEGER NOT NULL DEFAULT 0,
        delta_cursor TEXT,
        cancellation_requested INTEGER NOT NULL DEFAULT 0,
        concurrency INTEGER NOT NULL,
        baseline_imported INTEGER NOT NULL DEFAULT 0,
        delta_imported INTEGER NOT NULL DEFAULT 0,
        reconciled INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        duplicate_prevented INTEGER NOT NULL DEFAULT 0,
        failures_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS migration_items (
        migration_id TEXT NOT NULL REFERENCES migrations(id) ON DELETE CASCADE,
        item_key TEXT NOT NULL,
        source_folder_id TEXT NOT NULL,
        source_uid INTEGER,
        source_id TEXT,
        message_id TEXT,
        fingerprint TEXT,
        state TEXT NOT NULL,
        target_id TEXT,
        last_error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (migration_id, item_key)
      );
      CREATE INDEX IF NOT EXISTS migration_items_state ON migration_items(migration_id, state);
      CREATE INDEX IF NOT EXISTS migration_items_fingerprint ON migration_items(migration_id, fingerprint);
      CREATE INDEX IF NOT EXISTS migration_items_msgid ON migration_items(migration_id, message_id);
    `)
  }

  static open(path = ':memory:'): MigrationStore {
    return new MigrationStore(path, new DatabaseSync(path))
  }

  create(id: string, protocol: MigrationProtocol, concurrency: number): MigrationRecord {
    this.assertOpen()
    this.db
      .prepare(
        `INSERT INTO migrations(id, protocol, status, concurrency) VALUES (?, ?, 'created', ?)`,
      )
      .run(id, protocol, concurrency)
    return this.get(id)
  }

  get(id: string): MigrationRecord {
    this.assertOpen()
    const row = this.db.prepare('SELECT * FROM migrations WHERE id = ?').get(id) as
      StoredMigrationRow | undefined
    if (row === undefined) {
      throw new Error(`Unknown migration ${id}`)
    }
    const failures = JSON.parse(row.failures_json) as MigrationFailure[]
    return {
      id: row.id,
      protocol: row.protocol,
      status: row.status,
      baselineCursor: row.baseline_cursor ?? undefined,
      baselineDone: row.baseline_done === 1,
      deltaCursor: row.delta_cursor ?? undefined,
      cancellationRequested: row.cancellation_requested === 1,
      concurrency: row.concurrency,
      counters: {
        baselineImported: row.baseline_imported,
        deltaImported: row.delta_imported,
        reconciled: row.reconciled,
        deleted: row.deleted,
        duplicatePrevented: row.duplicate_prevented,
      },
      failures,
    }
  }

  setStatus(id: string, status: MigrationRecord['status']): void {
    this.db.prepare('UPDATE migrations SET status = ? WHERE id = ?').run(status, id)
  }

  requestCancellation(id: string): void {
    this.db.prepare('UPDATE migrations SET cancellation_requested = 1 WHERE id = ?').run(id)
  }

  isCancellationRequested(id: string): boolean {
    const row = this.db
      .prepare('SELECT cancellation_requested FROM migrations WHERE id = ?')
      .get(id) as { cancellation_requested: number } | undefined
    return row?.cancellation_requested === 1
  }

  clearCancellation(id: string): void {
    this.db.prepare('UPDATE migrations SET cancellation_requested = 0 WHERE id = ?').run(id)
  }

  setBaselineCursor(id: string, cursor: string | undefined, done: boolean): void {
    this.db
      .prepare('UPDATE migrations SET baseline_cursor = ?, baseline_done = ? WHERE id = ?')
      .run(cursor ?? null, done ? 1 : 0, id)
  }

  setDeltaCursor(id: string, cursor: string | undefined): void {
    this.db.prepare('UPDATE migrations SET delta_cursor = ? WHERE id = ?').run(cursor ?? null, id)
  }

  addCounter(
    id: string,
    counter:
      'baseline_imported' | 'delta_imported' | 'reconciled' | 'deleted' | 'duplicate_prevented',
  ): void {
    this.db.prepare(`UPDATE migrations SET ${counter} = ${counter} + 1 WHERE id = ?`).run(id)
  }

  appendFailure(id: string, failure: MigrationFailure): void {
    const record = this.get(id)
    record.failures.push(failure)
    this.db
      .prepare('UPDATE migrations SET failures_json = ? WHERE id = ?')
      .run(JSON.stringify(record.failures), id)
  }

  removeFailure(id: string, itemKey: string): void {
    const record = this.get(id)
    const filtered = record.failures.filter((f) => f.itemKey !== itemKey)
    if (filtered.length !== record.failures.length) {
      this.db
        .prepare('UPDATE migrations SET failures_json = ? WHERE id = ?')
        .run(JSON.stringify(filtered), id)
    }
  }

  ensureItem(migrationId: string, item: InventoryItem, fingerprint?: string): string {
    const key = itemKey(item)
    const fp = fingerprint ?? item.fingerprint ?? null
    this.db
      .prepare(
        `INSERT OR IGNORE INTO migration_items
          (migration_id, item_key, source_folder_id, source_uid, source_id, message_id, fingerprint, state, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        migrationId,
        key,
        item.sourceFolderId,
        item.sourceUid ?? null,
        item.sourceId ?? null,
        item.messageId ?? null,
        fp,
        new Date().toISOString(),
      )
    return key
  }

  findCompletedByFingerprint(
    migrationId: string,
    fingerprint: string,
  ): MigrationItemStateRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT item_key, state, target_id FROM migration_items WHERE migration_id = ? AND fingerprint = ? AND state = 'completed' LIMIT 1",
      )
      .get(migrationId, fingerprint) as StoredItemRow | undefined
    if (row === undefined) return undefined
    return { itemKey: row.item_key, state: row.state, targetId: row.target_id ?? undefined }
  }

  findCompletedByMessageId(
    migrationId: string,
    messageId: string,
  ): MigrationItemStateRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT item_key, state, target_id FROM migration_items WHERE migration_id = ? AND message_id = ? AND state = 'completed' LIMIT 1",
      )
      .get(migrationId, messageId) as StoredItemRow | undefined
    if (row === undefined) return undefined
    return { itemKey: row.item_key, state: row.state, targetId: row.target_id ?? undefined }
  }

  setFingerprint(migrationId: string, key: string, fingerprint: string): void {
    this.db
      .prepare('UPDATE migration_items SET fingerprint = ? WHERE migration_id = ? AND item_key = ?')
      .run(fingerprint, migrationId, key)
  }

  getItem(migrationId: string, key: string): MigrationItemStateRecord | undefined {
    const row = this.db
      .prepare(
        'SELECT item_key, state, target_id FROM migration_items WHERE migration_id = ? AND item_key = ?',
      )
      .get(migrationId, key) as StoredItemRow | undefined
    if (row === undefined) return undefined
    return { itemKey: row.item_key, state: row.state, targetId: row.target_id ?? undefined }
  }

  markRunning(migrationId: string, key: string): void {
    this.db
      .prepare(
        `UPDATE migration_items SET state = 'running', attempts = attempts + 1, updated_at = ?
         WHERE migration_id = ? AND item_key = ?`,
      )
      .run(new Date().toISOString(), migrationId, key)
  }

  markCompleted(migrationId: string, key: string, targetId: string, fingerprint?: string): void {
    if (fingerprint !== undefined) {
      this.db
        .prepare(
          `UPDATE migration_items SET state = 'completed', target_id = ?, fingerprint = coalesce(?, fingerprint), last_error = NULL, updated_at = ?
           WHERE migration_id = ? AND item_key = ?`,
        )
        .run(targetId, fingerprint, new Date().toISOString(), migrationId, key)
    } else {
      this.db
        .prepare(
          `UPDATE migration_items SET state = 'completed', target_id = ?, last_error = NULL, updated_at = ?
           WHERE migration_id = ? AND item_key = ?`,
        )
        .run(targetId, new Date().toISOString(), migrationId, key)
    }
  }

  markDeleted(migrationId: string, key: string): void {
    this.db
      .prepare(
        `UPDATE migration_items SET state = 'deleted', updated_at = ? WHERE migration_id = ? AND item_key = ?`,
      )
      .run(new Date().toISOString(), migrationId, key)
  }

  markFailed(migrationId: string, key: string, message: string): void {
    this.db
      .prepare(
        `UPDATE migration_items SET state = 'failed', last_error = ?, updated_at = ? WHERE migration_id = ? AND item_key = ?`,
      )
      .run(message, new Date().toISOString(), migrationId, key)
  }

  resetRunningItems(migrationId: string): void {
    this.db
      .prepare(
        "UPDATE migration_items SET state = 'pending' WHERE migration_id = ? AND state = 'running'",
      )
      .run(migrationId)
  }

  getPendingOrFailedItems(
    migrationId: string,
  ): Array<{ itemKey: string; item: InventoryItem; state: MigrationItemState }> {
    const rows = this.db
      .prepare(
        `SELECT item_key, source_folder_id, source_uid, source_id, message_id, fingerprint, state
         FROM migration_items
         WHERE migration_id = ? AND state IN ('pending', 'failed')
         ORDER BY item_key`,
      )
      .all(migrationId) as unknown as Array<{
      item_key: string
      source_folder_id: string
      source_uid: number | null
      source_id: string | null
      message_id: string | null
      fingerprint: string | null
      state: MigrationItemState
    }>
    return rows.map((r) => ({
      itemKey: r.item_key,
      state: r.state,
      item: {
        sourceFolderId: r.source_folder_id,
        sourceUid: r.source_uid ?? undefined,
        sourceId: r.source_id ?? undefined,
        messageId: r.message_id ?? undefined,
        fingerprint: r.fingerprint ?? undefined,
      },
    }))
  }

  listItems(migrationId: string): MigrationItemStateRecord[] {
    const rows = this.db
      .prepare(
        'SELECT item_key, state, target_id FROM migration_items WHERE migration_id = ? ORDER BY item_key',
      )
      .all(migrationId) as unknown as StoredItemRow[]
    return rows.map((row) => ({
      itemKey: row.item_key,
      state: row.state,
      targetId: row.target_id ?? undefined,
    }))
  }

  close(): void {
    if (!this.closed) {
      this.closed = true
      this.db.close()
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Migration store is closed')
  }
}

export function isAbortRequested(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false
}

export function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
