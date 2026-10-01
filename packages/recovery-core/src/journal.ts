import { DatabaseSync } from 'node:sqlite'

interface GenerationRow {
  generation_id: string
  key_reference: string
  status: 'writing' | 'complete'
  created_at: string
}

export class RecoveryJournal {
  private readonly db: DatabaseSync
  private closed = false

  constructor(readonly path: string) {
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = NORMAL')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recovery_generations (
        generation_id TEXT PRIMARY KEY,
        key_reference TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recovery_uploads (
        generation_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        object_key TEXT NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY (generation_id, content_hash),
        FOREIGN KEY (generation_id) REFERENCES recovery_generations(generation_id)
      );
    `)
  }

  ensureGeneration(generationId: string, keyReference: string, createdAt: string): void {
    this.assertOpen()
    const existing = this.db
      .prepare('SELECT * FROM recovery_generations WHERE generation_id = ?')
      .get(generationId) as GenerationRow | undefined
    if (existing !== undefined && existing.key_reference !== keyReference) {
      throw new Error('Generation already exists with a different key reference')
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO recovery_generations(generation_id, key_reference, status, created_at)
         VALUES (?, ?, 'writing', ?)`,
      )
      .run(generationId, keyReference, createdAt)
  }

  isComplete(generationId: string): boolean {
    this.assertOpen()
    const row = this.db
      .prepare('SELECT status FROM recovery_generations WHERE generation_id = ?')
      .get(generationId) as { status: string } | undefined
    return row?.status === 'complete'
  }

  hasUpload(generationId: string, contentHash: string): boolean {
    this.assertOpen()
    const row = this.db
      .prepare('SELECT status FROM recovery_uploads WHERE generation_id = ? AND content_hash = ?')
      .get(generationId, contentHash) as { status: string } | undefined
    return row?.status === 'uploaded'
  }

  getUpload(generationId: string, contentHash: string): string | undefined {
    this.assertOpen()
    const row = this.db
      .prepare(
        "SELECT object_key FROM recovery_uploads WHERE generation_id = ? AND content_hash = ? AND status = 'uploaded'",
      )
      .get(generationId, contentHash) as { object_key: string } | undefined
    return row?.object_key
  }

  markUploaded(generationId: string, contentHash: string, objectKey: string): void {
    this.assertOpen()
    this.db
      .prepare(
        `INSERT INTO recovery_uploads(generation_id, content_hash, object_key, status)
         VALUES (?, ?, ?, 'uploaded')
         ON CONFLICT(generation_id, content_hash) DO UPDATE SET object_key = excluded.object_key, status = 'uploaded'`,
      )
      .run(generationId, contentHash, objectKey)
  }

  markComplete(generationId: string): void {
    this.assertOpen()
    this.db
      .prepare("UPDATE recovery_generations SET status = 'complete' WHERE generation_id = ?")
      .run(generationId)
  }

  close(): void {
    if (!this.closed) {
      this.closed = true
      this.db.close()
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Recovery journal is closed')
  }
}
