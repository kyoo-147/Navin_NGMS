import { AuthError } from '../errors.js'
import {
  cloneSession,
  type AuthStore,
  type CreateUserInput,
  type SessionRecord,
  type TransactionPoint,
  type UserRecord,
} from './store.js'

/** In-memory store for unit tests and ephemeral runtimes. */
export class InMemoryAuthStore implements AuthStore {
  private readonly users = new Map<string, UserRecord>()
  private readonly emailIndex = new Map<string, string>()
  private readonly sessions = new Map<string, SessionRecord>()

  createUser(input: CreateUserInput): UserRecord {
    const email = input.email.toLowerCase()
    if (this.emailIndex.has(email)) {
      throw new AuthError('EMAIL_IN_USE')
    }
    const user: UserRecord = {
      userId: input.userId,
      accountId: input.accountId,
      email,
      passwordHash: input.passwordHash,
      roles: [...input.roles],
      displayName: input.displayName,
      disabled: input.disabled ?? false,
      createdAt: input.createdAt,
    }
    this.users.set(user.userId, user)
    this.emailIndex.set(email, user.userId)
    return { ...user }
  }

  getUserById(userId: string): UserRecord | undefined {
    const user = this.users.get(userId)
    return user ? { ...user } : undefined
  }

  getUserByEmail(email: string): UserRecord | undefined {
    const userId = this.emailIndex.get(email.toLowerCase())
    return userId ? this.getUserById(userId) : undefined
  }

  updateUserPassword(userId: string, passwordHash: string): void {
    const user = this.users.get(userId)
    if (!user) {
      throw new AuthError('NOT_FOUND')
    }
    user.passwordHash = passwordHash
  }

  setUserDisabled(userId: string, disabled: boolean): void {
    const user = this.users.get(userId)
    if (!user) {
      throw new AuthError('NOT_FOUND')
    }
    user.disabled = disabled
  }

  createSession(session: SessionRecord): void {
    if (this.sessions.has(session.sessionId)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'session_exists' })
    }
    this.sessions.set(session.sessionId, cloneSession(session))
  }

  getSession(sessionId: string): SessionRecord | undefined {
    const session = this.sessions.get(sessionId)
    return session ? cloneSession(session) : undefined
  }

  updateSession(session: SessionRecord): void {
    if (!this.sessions.has(session.sessionId)) {
      throw new AuthError('SESSION_NOT_FOUND')
    }
    this.sessions.set(session.sessionId, cloneSession(session))
  }

  revokeSession(sessionId: string, revokedAt: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    session.revokedAt = revokedAt
  }

  revokeUserSessions(userId: string, revokedAt: string): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = revokedAt
        count += 1
      }
    }
    return count
  }

  listUserSessions(userId: string): SessionRecord[] {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .map((session) => cloneSession(session))
  }

  rotateSession(previousSessionId: string, newSession: SessionRecord, revokedAt: string): void {
    if (newSession.sessionId === previousSessionId) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'rotation_reuses_session_id' })
    }
    this.transaction('rotate_session', () => {
      const previous = this.sessions.get(previousSessionId)
      if (!previous || previous.revokedAt) {
        throw new AuthError('SESSION_NOT_FOUND')
      }
      if (this.sessions.has(newSession.sessionId)) {
        throw new AuthError('VALIDATION_FAILED', { reason: 'session_exists' })
      }
      previous.revokedAt = revokedAt
      previous.rotatedTo = newSession.sessionId
      this.sessions.set(newSession.sessionId, cloneSession(newSession))
    })
  }

  changePasswordAndRevokeSessions(userId: string, passwordHash: string, revokedAt: string): number {
    return this.transaction('change_password', () => {
      const user = this.users.get(userId)
      if (!user) {
        throw new AuthError('NOT_FOUND')
      }
      user.passwordHash = passwordHash
      let revoked = 0
      for (const session of this.sessions.values()) {
        if (session.userId === userId && !session.revokedAt) {
          session.revokedAt = revokedAt
          revoked += 1
        }
      }
      return revoked
    })
  }

  /**
   * Runs `fn` against a snapshot and restores it on any throw. The store is
   * synchronous so this yields all-or-nothing semantics equivalent to the
   * SQLite transaction.
   */
  private transaction<T>(point: TransactionPoint, fn: () => T): T {
    const sessionBackup = new Map<string, SessionRecord>()
    for (const [id, session] of this.sessions) {
      sessionBackup.set(id, cloneSession(session))
    }
    const userBackup = new Map<string, UserRecord>()
    for (const [id, user] of this.users) {
      userBackup.set(id, { ...user, roles: [...user.roles] })
    }
    try {
      const result = fn()
      this.preCommit(point)
      return result
    } catch (error) {
      this.sessions.clear()
      for (const [id, session] of sessionBackup) {
        this.sessions.set(id, session)
      }
      this.users.clear()
      for (const [id, user] of userBackup) {
        this.users.set(id, user)
      }
      throw error
    }
  }

  /** Test seam: override to throw immediately before a transaction commits. */
  protected preCommit(point: TransactionPoint): void {
    void point
  }

  close(): void {
    this.users.clear()
    this.emailIndex.clear()
    this.sessions.clear()
  }
}
