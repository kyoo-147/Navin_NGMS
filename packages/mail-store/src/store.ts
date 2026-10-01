import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { MailAttachment, MessageId, ThreadId } from '@navin/contracts'
import type { NormalizedEmail, NormalizedMailbox } from '@navin/mail-gateway'

export interface CachedMessage extends NormalizedEmail {
  accountId: string
  cachedAt: string
  accessedAt: string
}

export interface AccountRecord {
  id: string
  username: string
  state: string | null
  updatedAt: string
}

export interface DraftRecord {
  id: string
  accountId: string
  senderIdentityId: string
  to: Array<{ name?: string; address: string }>
  cc: Array<{ name?: string; address: string }>
  bcc: Array<{ name?: string; address: string }>
  subject: string
  bodyText: string
  bodyHtml: string
  attachments: MailAttachment[]
  inReplyTo?: string
  references: string[]
  sendAt?: string
  updatedAt: string
  status: 'draft' | 'scheduled' | 'sent' | 'failed'
}

export interface OutboxItem {
  id: string
  accountId: string
  kind: 'mutation' | 'submission'
  idempotencyKey: string
  payload: Record<string, unknown>
  dependencyId: string | null
  status: 'pending' | 'processing' | 'sent' | 'needs_attention'
  attempts: number
  lastError: string | null
  createdAt: string
}

export interface ConflictRecord {
  id: string
  accountId: string
  outboxId: string
  reason: string
  detail: string
  createdAt: string
}

export interface MailStoreOptions {
  path: string
  quotaBytes?: number
  encryptionKey?: Uint8Array
  now?: () => string
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, state TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mailboxes (
  account_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, parent_id TEXT, role TEXT,
  sort_order INTEGER NOT NULL, total_emails INTEGER NOT NULL, unread_emails INTEGER NOT NULL,
  total_threads INTEGER NOT NULL, unread_threads INTEGER NOT NULL, payload TEXT NOT NULL,
  cached_at TEXT NOT NULL, accessed_at TEXT NOT NULL, PRIMARY KEY(account_id,id)
);
CREATE TABLE IF NOT EXISTS messages (
  account_id TEXT NOT NULL, id TEXT NOT NULL, thread_id TEXT NOT NULL, subject TEXT NOT NULL,
  received_at TEXT NOT NULL, is_unread INTEGER NOT NULL, is_starred INTEGER NOT NULL,
  has_attachment INTEGER NOT NULL, preview TEXT NOT NULL, payload TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL, cached_at TEXT NOT NULL, accessed_at TEXT NOT NULL,
  PRIMARY KEY(account_id,id)
);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(account_id,thread_id);
CREATE INDEX IF NOT EXISTS messages_access_idx ON messages(accessed_at);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
  status TEXT NOT NULL, payload_bytes INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL, dependency_id TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_ready_idx ON outbox(status,created_at);
CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, outbox_id TEXT NOT NULL, reason TEXT NOT NULL,
  detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
  account_id TEXT PRIMARY KEY, email_state TEXT NOT NULL, updated_at TEXT NOT NULL
);
`

function json(value: unknown): string {
  return JSON.stringify(value)
}
function canonicalJson(value: unknown): string {
  return canonicalNormalizedJson(JSON.parse(JSON.stringify(value)) as unknown)
}
function canonicalNormalizedJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalNormalizedJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalNormalizedJson(record[key])}`)
    .join(',')}}`
}
function parse<T>(value: string): T {
  return JSON.parse(value) as T
}
function byteSize(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}
function keyBytes(key: Uint8Array): Buffer {
  return createHash('sha256').update(key).digest()
}

/**
 * The local SQLite database is authoritative for rendered state while disconnected.
 * Server mutations enter the durable outbox before dispatch and are replayed in
 * dependency order after a restart. Bodies can be encrypted at rest when a key
 * is supplied; the database never stores the key.
 */
export class MailStore {
  readonly path: string
  private readonly db: DatabaseSync
  private readonly quotaBytes: number
  private readonly encryptionKey?: Buffer
  private readonly now: () => string

  constructor(options: MailStoreOptions) {
    this.path = options.path
    this.quotaBytes = options.quotaBytes ?? 50 * 1024 * 1024
    this.encryptionKey = options.encryptionKey ? keyBytes(options.encryptionKey) : undefined
    this.now = options.now ?? (() => new Date().toISOString())
    this.db = new DatabaseSync(options.path)
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;',
    )
    this.db.exec(SCHEMA)
    // A crash after durable reservation but before recording the response has
    // an unknown outcome. Replaying the same persisted idempotency key is the
    // only safe automatic recovery path.
    this.db.prepare("UPDATE outbox SET status='pending' WHERE status='processing'").run()
  }

  close(): void {
    this.db.close()
  }

  private encode(value: unknown): string {
    const plain = json(value)
    if (!this.encryptionKey) return plain
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv)
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return `enc:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`
  }

  private decode<T>(value: string): T {
    if (!value.startsWith('enc:')) return parse<T>(value)
    if (!this.encryptionKey) throw new Error('Encrypted mail payload requires an encryption key')
    const [, ivText, tagText, cipherText] = value.split(':')
    if (!ivText || !tagText || !cipherText) throw new Error('Invalid encrypted mail payload')
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(ivText, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    return parse<T>(
      Buffer.concat([
        decipher.update(Buffer.from(cipherText, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    )
  }

  private transaction(work: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      work()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  putAccount(accountId: string, username: string, state: string | null): void {
    this.db
      .prepare(
        `INSERT INTO accounts(id,username,state,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username,state=excluded.state,updated_at=excluded.updated_at`,
      )
      .run(accountId, username, state, this.now())
  }

  getAccount(accountId: string): AccountRecord | null {
    const row = this.db
      .prepare('SELECT id, username, state, updated_at as updatedAt FROM accounts WHERE id=?')
      .get(accountId) as AccountRecord | undefined
    return row ?? null
  }

  listAccounts(): AccountRecord[] {
    return this.db
      .prepare('SELECT id, username, state, updated_at as updatedAt FROM accounts ORDER BY id')
      .all() as unknown as AccountRecord[]
  }

  putMailboxes(accountId: string, mailboxes: readonly NormalizedMailbox[]): void {
    const statement = this.db
      .prepare(`INSERT INTO mailboxes(account_id,id,name,parent_id,role,sort_order,total_emails,unread_emails,total_threads,unread_threads,payload,cached_at,accessed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET name=excluded.name,parent_id=excluded.parent_id,role=excluded.role,sort_order=excluded.sort_order,total_emails=excluded.total_emails,unread_emails=excluded.unread_emails,total_threads=excluded.total_threads,unread_threads=excluded.unread_threads,payload=excluded.payload,cached_at=excluded.cached_at,accessed_at=excluded.accessed_at`)
    const now = this.now()
    this.transaction(() => {
      for (const mailbox of mailboxes)
        statement.run(
          accountId,
          mailbox.id,
          mailbox.name,
          mailbox.parentId,
          mailbox.role,
          mailbox.sortOrder,
          mailbox.totalEmails,
          mailbox.unreadEmails,
          mailbox.totalThreads,
          mailbox.unreadThreads,
          json(mailbox),
          now,
          now,
        )
    })
  }

  listMailboxes(accountId: string): NormalizedMailbox[] {
    const rows = this.db
      .prepare('SELECT payload FROM mailboxes WHERE account_id=? ORDER BY sort_order,id')
      .all(accountId) as Array<{ payload: string }>
    return rows.map((row) => parse<NormalizedMailbox>(row.payload))
  }

  getMailbox(accountId: string, mailboxId: string): NormalizedMailbox | null {
    const row = this.db
      .prepare('SELECT payload FROM mailboxes WHERE account_id=? AND id=?')
      .get(accountId, mailboxId) as { payload: string } | undefined
    return row ? parse<NormalizedMailbox>(row.payload) : null
  }

  putMessage(message: NormalizedEmail, accountId: string): void {
    const payload = this.encode(message)
    const now = this.now()
    this.db
      .prepare(
        `INSERT INTO messages(account_id,id,thread_id,subject,received_at,is_unread,is_starred,has_attachment,preview,payload,payload_bytes,cached_at,accessed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET thread_id=excluded.thread_id,subject=excluded.subject,received_at=excluded.received_at,is_unread=excluded.is_unread,is_starred=excluded.is_starred,has_attachment=excluded.has_attachment,preview=excluded.preview,payload=excluded.payload,payload_bytes=excluded.payload_bytes,cached_at=excluded.cached_at,accessed_at=excluded.accessed_at`,
      )
      .run(
        accountId,
        message.id,
        message.threadId,
        message.subject,
        message.receivedAt,
        message.isUnread ? 1 : 0,
        message.isStarred ? 1 : 0,
        message.hasAttachment ? 1 : 0,
        message.preview,
        payload,
        byteSize(payload),
        now,
        now,
      )
    this.prune()
  }

  putMessages(accountId: string, messages: readonly NormalizedEmail[]): void {
    this.transaction(() => {
      for (const message of messages) this.putMessage(message, accountId)
    })
  }

  getMessage(accountId: string, messageId: MessageId): CachedMessage | null {
    const row = this.db
      .prepare('SELECT payload,cached_at,accessed_at FROM messages WHERE account_id=? AND id=?')
      .get(accountId, messageId) as
      { payload: string; cached_at: string; accessed_at: string } | undefined
    if (!row) return null
    const accessedAt = this.now()
    this.db
      .prepare('UPDATE messages SET accessed_at=? WHERE account_id=? AND id=?')
      .run(accessedAt, accountId, messageId)
    return {
      ...this.decode<NormalizedEmail>(row.payload),
      accountId,
      cachedAt: row.cached_at,
      accessedAt,
    }
  }

  getThread(accountId: string, threadId: ThreadId): CachedMessage[] {
    const rows = this.db
      .prepare('SELECT id FROM messages WHERE account_id=? AND thread_id=? ORDER BY received_at')
      .all(accountId, threadId) as Array<{ id: MessageId }>
    return rows
      .map((row) => this.getMessage(accountId, row.id))
      .filter((value): value is CachedMessage => value !== null)
  }

  queryCachedMessages(
    accountId: string,
    filter?: { inMailbox?: string; isUnread?: boolean; isStarred?: boolean; limit?: number },
  ): CachedMessage[] {
    let sql = 'SELECT id FROM messages WHERE account_id=?'
    const params: Array<string | number> = [accountId]
    if (filter?.isUnread !== undefined) {
      sql += ' AND is_unread=?'
      params.push(filter.isUnread ? 1 : 0)
    }
    if (filter?.isStarred !== undefined) {
      sql += ' AND is_starred=?'
      params.push(filter.isStarred ? 1 : 0)
    }
    sql += ' ORDER BY received_at DESC'
    if (filter?.limit) {
      sql += ' LIMIT ?'
      params.push(filter.limit)
    }
    const rows = this.db.prepare(sql).all(...params) as Array<{ id: MessageId }>
    const messages = rows
      .map((r) => this.getMessage(accountId, r.id))
      .filter((m): m is CachedMessage => m !== null)
    if (filter?.inMailbox) {
      return messages.filter((m) => (m.mailboxIds as readonly string[]).includes(filter.inMailbox!))
    }
    return messages
  }

  removeMessage(accountId: string, messageId: string): void {
    this.db.prepare('DELETE FROM messages WHERE account_id=? AND id=?').run(accountId, messageId)
  }

  upsertDraft(draft: DraftRecord): void {
    const payload = this.encode(draft)
    this.db
      .prepare(
        `INSERT INTO drafts(id,account_id,payload,updated_at,status,payload_bytes) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,status=excluded.status,payload_bytes=excluded.payload_bytes`,
      )
      .run(draft.id, draft.accountId, payload, draft.updatedAt, draft.status, byteSize(payload))
    this.prune()
  }

  getDraft(id: string): DraftRecord | null {
    const row = this.db.prepare('SELECT payload FROM drafts WHERE id=?').get(id) as
      { payload: string } | undefined
    return row ? this.decode<DraftRecord>(row.payload) : null
  }

  listDrafts(accountId: string): DraftRecord[] {
    const rows = this.db
      .prepare('SELECT payload FROM drafts WHERE account_id=? ORDER BY updated_at DESC')
      .all(accountId) as Array<{ payload: string }>
    return rows.map((row) => this.decode<DraftRecord>(row.payload))
  }

  deleteDraft(id: string): void {
    this.db.prepare('DELETE FROM drafts WHERE id=?').run(id)
  }

  enqueue(item: Omit<OutboxItem, 'status' | 'attempts' | 'lastError' | 'createdAt'>): OutboxItem {
    const createdAt = this.now()
    const payload = this.encode(item.payload)
    this.db
      .prepare(
        `INSERT INTO outbox(id,account_id,kind,idempotency_key,payload,dependency_id,status,attempts,last_error,created_at)
         VALUES(?,?,?,?,?,?,?,0,NULL,?) ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(
        item.id,
        item.accountId,
        item.kind,
        item.idempotencyKey,
        payload,
        item.dependencyId,
        'pending',
        createdAt,
      )

    const row = this.db
      .prepare('SELECT * FROM outbox WHERE idempotency_key=?')
      .get(item.idempotencyKey) as Record<string, unknown> | undefined
    if (!row) throw new Error('Failed to reserve durable outbox item')

    const existing = this.rowOutbox(row)
    if (
      existing.accountId !== item.accountId ||
      existing.kind !== item.kind ||
      existing.dependencyId !== item.dependencyId ||
      canonicalJson(existing.payload) !== canonicalJson(item.payload)
    ) {
      throw new Error('Idempotency key is already bound to a different outbox operation')
    }
    return existing
  }

  listOutbox(accountId?: string): OutboxItem[] {
    const rows = (
      accountId
        ? this.db
            .prepare('SELECT * FROM outbox WHERE account_id=? ORDER BY created_at')
            .all(accountId)
        : this.db.prepare('SELECT * FROM outbox ORDER BY created_at').all()
    ) as Array<Record<string, unknown>>
    return rows.map((row) => this.rowOutbox(row))
  }

  markOutboxProcessing(id: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE outbox SET status='processing',attempts=attempts+1 WHERE id=? AND status='pending'",
      )
      .run(id)
    return Number(result.changes) === 1
  }
  markOutboxPending(id: string, error: string | null = null): void {
    this.db.prepare("UPDATE outbox SET status='pending',last_error=? WHERE id=?").run(error, id)
  }
  markOutboxSent(id: string): void {
    this.db.prepare("UPDATE outbox SET status='sent',last_error=NULL WHERE id=?").run(id)
  }
  markOutboxAttention(id: string, error: string): void {
    this.db
      .prepare("UPDATE outbox SET status='needs_attention',last_error=? WHERE id=?")
      .run(error, id)
  }
  removeOutbox(id: string): void {
    this.db.prepare('DELETE FROM outbox WHERE id=?').run(id)
  }

  addConflict(record: Omit<ConflictRecord, 'createdAt'>): ConflictRecord {
    const conflict = { ...record, createdAt: this.now() }
    this.db
      .prepare(
        'INSERT INTO conflicts(id,account_id,outbox_id,reason,detail,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(
        conflict.id,
        conflict.accountId,
        conflict.outboxId,
        conflict.reason,
        conflict.detail,
        conflict.createdAt,
      )
    return conflict
  }

  listConflicts(accountId: string): ConflictRecord[] {
    return this.db
      .prepare(
        'SELECT id,account_id as accountId,outbox_id as outboxId,reason,detail,created_at as createdAt FROM conflicts WHERE account_id=? ORDER BY created_at',
      )
      .all(accountId) as unknown as ConflictRecord[]
  }

  resolveConflict(conflictId: string): void {
    this.db.prepare('DELETE FROM conflicts WHERE id=?').run(conflictId)
  }

  setSyncState(accountId: string, emailState: string): void {
    this.db
      .prepare(
        `INSERT INTO sync_state(account_id,email_state,updated_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET email_state=excluded.email_state,updated_at=excluded.updated_at`,
      )
      .run(accountId, emailState, this.now())
  }
  getSyncState(accountId: string): string | null {
    const row = this.db
      .prepare('SELECT email_state FROM sync_state WHERE account_id=?')
      .get(accountId) as { email_state: string } | undefined
    return row?.email_state ?? null
  }

  usageBytes(): number {
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(payload_bytes),0) AS bytes FROM messages UNION ALL SELECT COALESCE(SUM(payload_bytes),0) FROM drafts',
      )
      .all() as Array<{ bytes: number | bigint }>
    return row.reduce((sum, item) => sum + Number(item.bytes), 0)
  }

  private prune(): void {
    while (this.usageBytes() > this.quotaBytes) {
      const row = this.db
        .prepare('SELECT account_id,id FROM messages ORDER BY accessed_at LIMIT 1')
        .get() as { account_id: string; id: string } | undefined
      if (!row) break
      this.db
        .prepare('DELETE FROM messages WHERE account_id=? AND id=?')
        .run(row.account_id, row.id)
    }
  }

  private rowOutbox(row: Record<string, unknown>): OutboxItem {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      kind: row.kind as OutboxItem['kind'],
      idempotencyKey: String(row.idempotency_key),
      payload: this.decode<Record<string, unknown>>(String(row.payload)),
      dependencyId: row.dependency_id ? String(row.dependency_id) : null,
      status: row.status as OutboxItem['status'],
      attempts: Number(row.attempts),
      lastError: row.last_error ? String(row.last_error) : null,
      createdAt: String(row.created_at),
    }
  }
}

export type { StatementSync }
