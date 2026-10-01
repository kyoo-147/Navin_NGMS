import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { AuthError } from '../errors.js'
import type { AssuranceLevel, AuthScope, NavinRole, RelyingParty, Surface } from '../types.js'
import {
  cloneSession,
  type AuthStore,
  type CreateUserInput,
  type SessionRecord,
  type TransactionPoint,
  type UserRecord,
} from './store.js'

const SCHEMA_VERSION = 1

interface UserRow {
  user_id: string
  account_id: string
  email: string
  password_hash: string
  roles_json: string
  display_name: string | null
  disabled: number
  created_at: string
}

interface SessionRow {
  session_id: string
  user_id: string
  account_id: string
  email: string
  roles_json: string
  scopes_json: string
  relying_party: string
  surface: string
  assurance_level: string
  mailbox_id: string | null
  issued_at: string
  last_authenticated_at: string
  expires_at: string
  revoked_at: string | null
  rotated_from: string | null
  rotated_to: string | null
  token_hash: string
  csrf_secret: string
  user_agent: string | null
  ip_address: string | null
}

/**
 * SQLite-backed store (WAL mode) for users and sessions. Sessions persist only
 * a hash of the issued token and the server-side CSRF secret, never a raw
 * token, password or password hash material beyond the stored verifier.
 */
export class SqliteAuthStore implements AuthStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.migrate()
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version?: number }
    const version = Number(row?.user_version ?? 0)
    if (version >= SCHEMA_VERSION) {
      return
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id       TEXT PRIMARY KEY,
        account_id    TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        roles_json    TEXT NOT NULL,
        display_name  TEXT,
        disabled      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id            TEXT PRIMARY KEY,
        user_id               TEXT NOT NULL,
        account_id            TEXT NOT NULL,
        email                 TEXT NOT NULL,
        roles_json            TEXT NOT NULL,
        scopes_json           TEXT NOT NULL,
        relying_party         TEXT NOT NULL,
        surface               TEXT NOT NULL,
        assurance_level       TEXT NOT NULL,
        mailbox_id            TEXT,
        issued_at             TEXT NOT NULL,
        last_authenticated_at TEXT NOT NULL,
        expires_at            TEXT NOT NULL,
        revoked_at            TEXT,
        rotated_from          TEXT,
        rotated_to            TEXT,
        token_hash            TEXT NOT NULL,
        csrf_secret           TEXT NOT NULL,
        user_agent            TEXT,
        ip_address            TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    `)
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }

  createUser(input: CreateUserInput): UserRecord {
    const email = input.email.toLowerCase()
    const existing = this.getUserByEmail(email)
    if (existing) {
      throw new AuthError('EMAIL_IN_USE')
    }
    try {
      this.prepare(
        `INSERT INTO users (user_id, account_id, email, password_hash, roles_json, display_name, disabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.userId,
        input.accountId,
        email,
        input.passwordHash,
        JSON.stringify(input.roles),
        nullable(input.displayName),
        input.disabled ? 1 : 0,
        input.createdAt,
      )
    } catch (error) {
      if (error instanceof AuthError) {
        throw error
      }
      throw new AuthError('STORE_ERROR', { reason: 'insert_user_failed' })
    }
    const created = this.getUserById(input.userId)
    if (!created) {
      throw new AuthError('STORE_ERROR', { reason: 'user_not_readable' })
    }
    return created
  }

  getUserById(userId: string): UserRecord | undefined {
    const row = this.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as unknown as
      UserRow | undefined
    return row ? mapUser(row) : undefined
  }

  getUserByEmail(email: string): UserRecord | undefined {
    const row = this.prepare('SELECT * FROM users WHERE email = ?').get(
      email.toLowerCase(),
    ) as unknown as UserRow | undefined
    return row ? mapUser(row) : undefined
  }

  updateUserPassword(userId: string, passwordHash: string): void {
    const result = this.prepare('UPDATE users SET password_hash = ? WHERE user_id = ?').run(
      passwordHash,
      userId,
    )
    if (result.changes === 0) {
      throw new AuthError('NOT_FOUND')
    }
  }

  setUserDisabled(userId: string, disabled: boolean): void {
    const result = this.prepare('UPDATE users SET disabled = ? WHERE user_id = ?').run(
      disabled ? 1 : 0,
      userId,
    )
    if (result.changes === 0) {
      throw new AuthError('NOT_FOUND')
    }
  }

  createSession(session: SessionRecord): void {
    const existing = this.getSession(session.sessionId)
    if (existing) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'session_exists' })
    }
    this.insertSessionRow(session)
  }

  private insertSessionRow(session: SessionRecord): void {
    this.prepare(
      `INSERT INTO sessions (
        session_id, user_id, account_id, email, roles_json, scopes_json, relying_party, surface,
        assurance_level, mailbox_id, issued_at, last_authenticated_at, expires_at, revoked_at,
        rotated_from, rotated_to, token_hash, csrf_secret, user_agent, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      session.sessionId,
      session.userId,
      session.accountId,
      session.email,
      JSON.stringify(session.roles),
      JSON.stringify(session.scopes),
      session.relyingParty,
      session.surface,
      session.assuranceLevel,
      nullable(session.mailboxId),
      session.issuedAt,
      session.lastAuthenticatedAt,
      session.expiresAt,
      nullable(session.revokedAt),
      nullable(session.rotatedFrom),
      nullable(session.rotatedTo),
      session.tokenHash,
      session.csrfSecret,
      nullable(session.userAgent),
      nullable(session.ipAddress),
    )
  }

  getSession(sessionId: string): SessionRecord | undefined {
    const row = this.prepare('SELECT * FROM sessions WHERE session_id = ?').get(
      sessionId,
    ) as unknown as SessionRow | undefined
    return row ? mapSession(row) : undefined
  }

  updateSession(session: SessionRecord): void {
    const result = this.prepare(
      `UPDATE sessions SET
        user_id = ?, account_id = ?, email = ?, roles_json = ?, scopes_json = ?,
        relying_party = ?, surface = ?, assurance_level = ?, mailbox_id = ?, issued_at = ?,
        last_authenticated_at = ?, expires_at = ?, revoked_at = ?, rotated_from = ?, rotated_to = ?,
        token_hash = ?, csrf_secret = ?, user_agent = ?, ip_address = ?
       WHERE session_id = ?`,
    ).run(
      session.userId,
      session.accountId,
      session.email,
      JSON.stringify(session.roles),
      JSON.stringify(session.scopes),
      session.relyingParty,
      session.surface,
      session.assuranceLevel,
      nullable(session.mailboxId),
      session.issuedAt,
      session.lastAuthenticatedAt,
      session.expiresAt,
      nullable(session.revokedAt),
      nullable(session.rotatedFrom),
      nullable(session.rotatedTo),
      session.tokenHash,
      session.csrfSecret,
      nullable(session.userAgent),
      nullable(session.ipAddress),
      session.sessionId,
    )
    if (result.changes === 0) {
      throw new AuthError('SESSION_NOT_FOUND')
    }
  }

  revokeSession(sessionId: string, revokedAt: string): void {
    this.prepare(
      'UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL',
    ).run(revokedAt, sessionId)
  }

  revokeUserSessions(userId: string, revokedAt: string): number {
    const result = this.prepare(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    ).run(revokedAt, userId)
    return Number(result.changes)
  }

  listUserSessions(userId: string): SessionRecord[] {
    const rows = this.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY issued_at').all(
      userId,
    ) as unknown as SessionRow[]
    return rows.map(mapSession)
  }

  /**
   * Atomically revoke the previous session and insert the replacement inside a
   * single `BEGIN IMMEDIATE` transaction. Any failure rolls back, so two live
   * sessions can never coexist after a rotation.
   */
  rotateSession(previousSessionId: string, newSession: SessionRecord, revokedAt: string): void {
    if (newSession.sessionId === previousSessionId) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'rotation_reuses_session_id' })
    }
    this.transaction('rotate_session', () => {
      const result = this.prepare(
        'UPDATE sessions SET revoked_at = ?, rotated_to = ? WHERE session_id = ? AND revoked_at IS NULL',
      ).run(revokedAt, newSession.sessionId, previousSessionId)
      if (Number(result.changes) === 0) {
        throw new AuthError('SESSION_NOT_FOUND')
      }
      this.insertSessionRow(newSession)
    })
  }

  /**
   * Atomically change the password verifier and revoke every session for the
   * user. A failure rolls both back, so a changed password can never coexist
   * with a still-active old session.
   */
  changePasswordAndRevokeSessions(userId: string, passwordHash: string, revokedAt: string): number {
    return this.transaction('change_password', () => {
      const updated = this.prepare('UPDATE users SET password_hash = ? WHERE user_id = ?').run(
        passwordHash,
        userId,
      )
      if (Number(updated.changes) === 0) {
        throw new AuthError('NOT_FOUND')
      }
      const revoked = this.prepare(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      ).run(revokedAt, userId)
      return Number(revoked.changes)
    })
  }

  private transaction<T>(point: TransactionPoint, fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.preCommit(point)
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Transaction already rolled back by SQLite.
      }
      throw error
    }
  }

  /** Test seam: override to throw immediately before a transaction commits. */
  protected preCommit(point: TransactionPoint): void {
    void point
  }

  close(): void {
    this.db.close()
  }

  private prepare(sql: string): StatementSync {
    return this.db.prepare(sql)
  }
}

function nullable(value: string | undefined): string | null {
  return value === undefined ? null : value
}

function mapUser(row: UserRow): UserRecord {
  const user: UserRecord = {
    userId: row.user_id,
    accountId: row.account_id,
    email: row.email,
    passwordHash: row.password_hash,
    roles: JSON.parse(row.roles_json) as NavinRole[],
    disabled: row.disabled === 1,
    createdAt: row.created_at,
  }
  if (row.display_name !== null) {
    user.displayName = row.display_name
  }
  return user
}

function mapSession(row: SessionRow): SessionRecord {
  const session: SessionRecord = {
    sessionId: row.session_id,
    userId: row.user_id,
    accountId: row.account_id,
    email: row.email,
    roles: JSON.parse(row.roles_json) as NavinRole[],
    scopes: JSON.parse(row.scopes_json) as AuthScope[],
    relyingParty: row.relying_party as RelyingParty,
    surface: row.surface as Surface,
    assuranceLevel: row.assurance_level as AssuranceLevel,
    issuedAt: row.issued_at,
    lastAuthenticatedAt: row.last_authenticated_at,
    expiresAt: row.expires_at,
    tokenHash: row.token_hash,
    csrfSecret: row.csrf_secret,
  }
  if (row.mailbox_id !== null) {
    session.mailboxId = row.mailbox_id
  }
  if (row.revoked_at !== null) {
    session.revokedAt = row.revoked_at
  }
  if (row.rotated_from !== null) {
    session.rotatedFrom = row.rotated_from
  }
  if (row.rotated_to !== null) {
    session.rotatedTo = row.rotated_to
  }
  if (row.user_agent !== null) {
    session.userAgent = row.user_agent
  }
  if (row.ip_address !== null) {
    session.ipAddress = row.ip_address
  }
  return cloneSession(session)
}
