import type { AssuranceLevel, AuthScope, NavinRole, RelyingParty, Surface } from '../types.js'

export interface UserRecord {
  userId: string
  accountId: string
  email: string
  passwordHash: string
  roles: NavinRole[]
  displayName?: string
  disabled: boolean
  createdAt: string
}

export interface SessionRecord {
  sessionId: string
  userId: string
  accountId: string
  email: string
  roles: NavinRole[]
  scopes: AuthScope[]
  relyingParty: RelyingParty
  surface: Surface
  assuranceLevel: AssuranceLevel
  mailboxId?: string
  issuedAt: string
  lastAuthenticatedAt: string
  expiresAt: string
  revokedAt?: string
  rotatedFrom?: string
  rotatedTo?: string
  tokenHash: string
  csrfSecret: string
  userAgent?: string
  ipAddress?: string
}

export interface CreateUserInput {
  userId: string
  accountId: string
  email: string
  passwordHash: string
  roles: NavinRole[]
  displayName?: string
  disabled?: boolean
  createdAt: string
}

/** Named points inside a store transaction, used as fault-injection seams. */
export type TransactionPoint = 'rotate_session' | 'change_password'

/**
 * Persistence boundary for users and sessions. Deliberately synchronous so the
 * SQLite (`node:sqlite`) and in-memory implementations are interchangeable and
 * restart tests are deterministic. Implementations MUST never store raw
 * passwords; sessions store only a hash of the issued token.
 *
 * `rotateSession` and `changePasswordAndRevokeSessions` are atomic: they either
 * apply in full or leave the store unchanged, so a crash or failure can never
 * leave two live sessions after a rotation, nor a changed password alongside
 * still-active old sessions.
 */
export interface AuthStore {
  createUser(input: CreateUserInput): UserRecord
  getUserById(userId: string): UserRecord | undefined
  getUserByEmail(email: string): UserRecord | undefined
  updateUserPassword(userId: string, passwordHash: string): void
  setUserDisabled(userId: string, disabled: boolean): void

  createSession(session: SessionRecord): void
  getSession(sessionId: string): SessionRecord | undefined
  updateSession(session: SessionRecord): void
  revokeSession(sessionId: string, revokedAt: string): void
  revokeUserSessions(userId: string, revokedAt: string): number
  listUserSessions(userId: string): SessionRecord[]

  /** Atomically revoke `previousSessionId` and insert `newSession`. */
  rotateSession(previousSessionId: string, newSession: SessionRecord, revokedAt: string): void
  /** Atomically update the verifier and revoke all of the user's sessions. */
  changePasswordAndRevokeSessions(userId: string, passwordHash: string, revokedAt: string): number

  close(): void
}

export function cloneSession(session: SessionRecord): SessionRecord {
  return {
    ...session,
    roles: [...session.roles],
    scopes: [...session.scopes],
  }
}
