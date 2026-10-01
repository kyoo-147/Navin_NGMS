import type { Clock } from './clock.js'
import { buildSessionCookie, sessionCookiePolicyFor } from './cookies.js'
import { deriveCsrfToken, assertStateChangingRequest } from './csrf.js'
import { constantTimeEqualHex, fromBase64Url, sha256Hex, toBase64Url } from './encoding.js'
import { AuthError } from './errors.js'
import type { TokenIssuer } from './issuers.js'
import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
  type PasswordPolicy,
} from './password.js'
import type { RandomSource } from './random.js'
import {
  authorize,
  rolesForRelyingParty,
  scopesForRoles,
  type AuthorizationDecision,
  type AuthorizationRequirement,
} from './rbac.js'
import { assertTier3 } from './risk.js'
import type { AuthStore, SessionRecord, UserRecord } from './store/store.js'
import {
  isSurface,
  surfacesForRelyingParty,
  type AssuranceLevel,
  type AuthScope,
  type NavinRole,
  type RelyingParty,
  type SessionPrincipal,
  type Surface,
} from './types.js'

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const USER_ID_PATTERN = /^usr_[a-zA-Z0-9._-]+$/
const ACCOUNT_ID_PATTERN = /^acc_[a-zA-Z0-9._-]+$/
const MAILBOX_ID_PATTERN = /^mbx_[a-zA-Z0-9._-]+$/

export type AuthAuditType =
  | 'login.succeeded'
  | 'login.failed'
  | 'session.rotated'
  | 'session.revoked'
  | 'session.step_up'
  | 'password.changed'
  | 'authorization.denied'
  | 'csrf.rejected'

/** Audit event carries only non-secret identifiers. */
export interface AuthAuditEvent {
  type: AuthAuditType
  at: string
  userId?: string
  sessionId?: string
  relyingParty?: RelyingParty
  surface?: Surface
  reason?: string
}

export interface AuthServiceOptions {
  store: AuthStore
  mailIssuer: TokenIssuer
  controlIssuer: TokenIssuer
  clock: Clock
  random: RandomSource
  passwordPolicy?: PasswordPolicy
  recentAuthWindowMs?: number
  allowedOriginsByRelyingParty?: Partial<Record<RelyingParty, readonly string[]>>
  audit?: (event: AuthAuditEvent) => void
  /** Injectable password verifier (defaults to scrypt `verifyPassword`). */
  passwordVerifier?: (password: string, encoded: string) => boolean
  /** Optional fixed dummy verifier used for unknown/disabled accounts. */
  dummyPasswordVerifier?: string
}

export interface CreateUserOptions {
  email: string
  password: string
  roles: NavinRole[]
  userId?: string
  accountId?: string
  displayName?: string
  disabled?: boolean
}

export interface LoginInput {
  email: string
  password: string
  relyingParty: RelyingParty
  surface: Surface
  mailboxId?: string
  mfaVerified?: boolean
  userAgent?: string
  ipAddress?: string
}

export interface ValidateInput {
  token: string
  relyingParty: RelyingParty
  surface?: Surface
}

export interface IssuedSession {
  sessionId: string
  token: string
  csrfToken: string
  cookie: string
  principal: SessionPrincipal
  relyingParty: RelyingParty
  surface: Surface
  assuranceLevel: AssuranceLevel
  mailboxId?: string
  issuedAt: string
  lastAuthenticatedAt: string
  expiresAt: string
}

export interface StepUpInput {
  sessionId: string
  password: string
  mfaVerified?: boolean
}

export interface ChangePasswordInput {
  userId: string
  currentPassword: string
  newPassword: string
}

export interface CsrfCheckInput {
  session: SessionRecord
  method: string
  csrfToken?: string | null
  origin?: string | null
  referer?: string | null
  host?: string | null
}

export interface Tier3Input {
  session: SessionRecord
  confirmation?: string
  expectedConfirmation: string
}

interface CreateSessionParams {
  user: UserRecord
  roles: NavinRole[]
  scopes: AuthScope[]
  relyingParty: RelyingParty
  surface: Surface
  assuranceLevel: AssuranceLevel
  lastAuthenticatedAt: string
  mailboxId?: string
  rotatedFrom?: string
  userAgent?: string
  ipAddress?: string
}

/**
 * Composes store, issuers, RBAC, risk and CSRF into the auth/session surface.
 * Every dependency (clock, randomness, persistence) is injected so behavior is
 * deterministic under test and the same code runs in production.
 */
export class AuthService {
  private readonly store: AuthStore
  private readonly mailIssuer: TokenIssuer
  private readonly controlIssuer: TokenIssuer
  private readonly clock: Clock
  private readonly random: RandomSource
  private readonly passwordPolicy?: PasswordPolicy
  private readonly recentAuthWindowMs: number
  private readonly allowedOrigins: Partial<Record<RelyingParty, readonly string[]>>
  private readonly auditSink?: (event: AuthAuditEvent) => void
  private readonly passwordVerifier: (password: string, encoded: string) => boolean
  private readonly configuredDummyVerifier?: string
  private dummyVerifier?: string

  constructor(options: AuthServiceOptions) {
    this.store = options.store
    this.mailIssuer = options.mailIssuer
    this.controlIssuer = options.controlIssuer
    this.clock = options.clock
    this.random = options.random
    this.passwordPolicy = options.passwordPolicy
    this.recentAuthWindowMs = options.recentAuthWindowMs ?? 10 * 60 * 1000
    this.allowedOrigins = options.allowedOriginsByRelyingParty ?? {}
    this.auditSink = options.audit
    this.passwordVerifier = options.passwordVerifier ?? verifyPassword
    this.configuredDummyVerifier = options.dummyPasswordVerifier
  }

  createUser(options: CreateUserOptions): UserRecord {
    const email = normalizeEmail(options.email)
    if (!EMAIL_PATTERN.test(email)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_email' })
    }
    if (!Array.isArray(options.roles) || options.roles.length === 0) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'roles_required' })
    }
    validatePasswordPolicy(options.password, this.passwordPolicy)
    const userId = options.userId ?? this.random.id('usr')
    const accountId = options.accountId ?? this.random.id('acc')
    if (!USER_ID_PATTERN.test(userId)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_user_id' })
    }
    if (!ACCOUNT_ID_PATTERN.test(accountId)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_account_id' })
    }
    return this.store.createUser({
      userId,
      accountId,
      email,
      passwordHash: hashPassword(options.password, { random: this.random }),
      roles: [...options.roles],
      displayName: options.displayName,
      disabled: options.disabled,
      createdAt: this.clock.now().toISOString(),
    })
  }

  login(input: LoginInput): IssuedSession {
    this.assertSurfaceForRelyingParty(input.relyingParty, input.surface)
    if (input.mailboxId !== undefined && !MAILBOX_ID_PATTERN.test(input.mailboxId)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_mailbox_id' })
    }
    const user = this.store.getUserByEmail(normalizeEmail(input.email))
    // Always perform a password verification, using a fixed dummy verifier when
    // the account is unknown, so unknown/disabled accounts are not observably
    // faster than a wrong password (user-enumeration timing defense).
    const verifier = user?.passwordHash ?? this.getDummyVerifier()
    const passwordOk = this.passwordVerifier(input.password, verifier)
    if (!user || user.disabled || !passwordOk) {
      this.audit('login.failed', {
        ...(user ? { userId: user.userId } : {}),
        relyingParty: input.relyingParty,
        surface: input.surface,
        reason: !user ? 'unknown_user' : user.disabled ? 'disabled' : 'bad_password',
      })
      throw new AuthError('INVALID_CREDENTIALS')
    }
    const roles = rolesForRelyingParty(user.roles, input.relyingParty)
    if (roles.length === 0) {
      this.audit('login.failed', {
        userId: user.userId,
        relyingParty: input.relyingParty,
        surface: input.surface,
        reason: 'no_role_for_relying_party',
      })
      throw new AuthError('FORBIDDEN')
    }
    const issued = this.createSession({
      user,
      roles,
      scopes: scopesForRoles(roles, input.relyingParty),
      relyingParty: input.relyingParty,
      surface: input.surface,
      assuranceLevel: input.mfaVerified ? 'mfa_verified' : 'standard',
      lastAuthenticatedAt: this.clock.now().toISOString(),
      mailboxId: input.mailboxId,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    })
    this.audit('login.succeeded', {
      userId: user.userId,
      sessionId: issued.sessionId,
      relyingParty: input.relyingParty,
      surface: input.surface,
    })
    return issued
  }

  validate(input: ValidateInput): SessionRecord {
    const issuer = input.relyingParty === 'navin-mail' ? this.mailIssuer : this.controlIssuer
    const payload = issuer.verify(input.token)
    if (input.surface && payload.surface !== input.surface) {
      throw new AuthError('FORBIDDEN', { reason: 'surface_mismatch' })
    }
    if (payload.relyingParty !== input.relyingParty) {
      throw new AuthError('WRONG_AUDIENCE')
    }
    const session = this.store.getSession(payload.sessionId)
    if (!session) {
      throw new AuthError('INVALID_TOKEN')
    }
    if (!constantTimeEqualHex(session.tokenHash, sha256Hex(input.token))) {
      throw new AuthError('INVALID_TOKEN')
    }
    // Fail closed: the persisted session must agree with the signed payload and
    // may not be reinterpreted as another relying party, surface, user or account.
    if (session.relyingParty !== payload.relyingParty) {
      throw new AuthError('WRONG_AUDIENCE')
    }
    if (session.surface !== payload.surface) {
      throw new AuthError('FORBIDDEN', { reason: 'session_surface_mismatch' })
    }
    if (
      session.userId !== payload.principal.userId ||
      session.accountId !== payload.principal.accountId ||
      session.email !== payload.principal.email
    ) {
      throw new AuthError('INVALID_TOKEN')
    }
    this.assertActive(session)
    // A disabled or removed account immediately loses its live sessions.
    const user = this.store.getUserById(session.userId)
    if (!user || user.disabled) {
      throw new AuthError('ACCOUNT_DISABLED')
    }
    return session
  }

  rotate(sessionId: string): IssuedSession {
    const session = this.requireActiveSession(sessionId)
    const user = this.requireUser(session.userId)
    const issued = this.replaceSession(session, {
      user,
      roles: session.roles,
      scopes: session.scopes,
      relyingParty: session.relyingParty,
      surface: session.surface,
      assuranceLevel: session.assuranceLevel,
      lastAuthenticatedAt: session.lastAuthenticatedAt,
      mailboxId: session.mailboxId,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
    })
    this.audit('session.rotated', {
      userId: session.userId,
      sessionId: issued.sessionId,
      relyingParty: session.relyingParty,
      surface: session.surface,
    })
    return issued
  }

  revoke(sessionId: string): void {
    const session = this.store.getSession(sessionId)
    if (!session) {
      throw new AuthError('SESSION_NOT_FOUND')
    }
    this.store.revokeSession(sessionId, this.clock.now().toISOString())
    this.audit('session.revoked', {
      userId: session.userId,
      sessionId,
      relyingParty: session.relyingParty,
      surface: session.surface,
    })
  }

  revokeAllForUser(userId: string): number {
    const count = this.store.revokeUserSessions(userId, this.clock.now().toISOString())
    this.audit('session.revoked', { userId, reason: `revoked_all:${count}` })
    return count
  }

  /** Device/session management: list a user's persisted sessions. */
  listSessionsForUser(userId: string): SessionRecord[] {
    return this.store.listUserSessions(userId)
  }

  stepUp(input: StepUpInput): IssuedSession {
    const session = this.requireActiveSession(input.sessionId)
    const user = this.requireUser(session.userId)
    if (!this.passwordVerifier(input.password, user.passwordHash)) {
      this.audit('login.failed', {
        userId: user.userId,
        sessionId: session.sessionId,
        relyingParty: session.relyingParty,
        surface: session.surface,
        reason: 'step_up_bad_password',
      })
      throw new AuthError('INVALID_CREDENTIALS')
    }
    const issued = this.replaceSession(session, {
      user,
      roles: session.roles,
      scopes: session.scopes,
      relyingParty: session.relyingParty,
      surface: session.surface,
      assuranceLevel: input.mfaVerified === false ? 'standard' : 'step_up_recent',
      lastAuthenticatedAt: this.clock.now().toISOString(),
      mailboxId: session.mailboxId,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
    })
    this.audit('session.step_up', {
      userId: session.userId,
      sessionId: issued.sessionId,
      relyingParty: session.relyingParty,
      surface: session.surface,
    })
    return issued
  }

  changePassword(input: ChangePasswordInput): number {
    const user = this.requireUser(input.userId)
    if (!this.passwordVerifier(input.currentPassword, user.passwordHash)) {
      this.audit('login.failed', { userId: user.userId, reason: 'change_password_bad_current' })
      throw new AuthError('INVALID_CREDENTIALS')
    }
    validatePasswordPolicy(input.newPassword, this.passwordPolicy)
    // Atomic: the verifier change and the session revocation commit together.
    const revoked = this.store.changePasswordAndRevokeSessions(
      user.userId,
      hashPassword(input.newPassword, { random: this.random }),
      this.clock.now().toISOString(),
    )
    this.audit('password.changed', { userId: user.userId, reason: `sessions_revoked:${revoked}` })
    return revoked
  }

  authorize(session: SessionRecord, requirement: AuthorizationRequirement): AuthorizationDecision {
    const decision = authorize(
      {
        relyingParty: session.relyingParty,
        surface: session.surface,
        roles: session.roles,
        scopes: session.scopes,
        assuranceLevel: session.assuranceLevel,
      },
      requirement,
    )
    if (!decision.allowed) {
      this.audit('authorization.denied', {
        userId: session.userId,
        sessionId: session.sessionId,
        relyingParty: session.relyingParty,
        surface: session.surface,
        reason: decision.reason,
      })
    }
    return decision
  }

  assertAuthorized(session: SessionRecord, requirement: AuthorizationRequirement): void {
    const decision = this.authorize(session, requirement)
    if (decision.allowed) {
      return
    }
    if (decision.reason === 'missing_scope' || decision.reason === 'missing_any_scope') {
      throw new AuthError('INSUFFICIENT_SCOPE', { missing: decision.missing ?? [] })
    }
    throw new AuthError('FORBIDDEN', { reason: decision.reason })
  }

  checkCsrf(input: CsrfCheckInput): void {
    try {
      assertStateChangingRequest({
        method: input.method,
        sessionId: input.session.sessionId,
        csrfSecret: fromBase64Url(input.session.csrfSecret),
        csrfToken: input.csrfToken,
        origin: input.origin,
        referer: input.referer,
        host: input.host,
        allowedOrigins: this.allowedOrigins[input.session.relyingParty] ?? [],
      })
    } catch (error) {
      this.audit('csrf.rejected', {
        userId: input.session.userId,
        sessionId: input.session.sessionId,
        relyingParty: input.session.relyingParty,
        surface: input.session.surface,
        reason: error instanceof AuthError ? error.code : 'csrf_error',
      })
      throw error
    }
  }

  csrfTokenFor(session: SessionRecord): string {
    return deriveCsrfToken(session.sessionId, fromBase64Url(session.csrfSecret))
  }

  assertTier3(input: Tier3Input): void {
    assertTier3({
      session: {
        assuranceLevel: input.session.assuranceLevel,
        lastAuthenticatedAt: input.session.lastAuthenticatedAt,
      },
      confirmation: input.confirmation,
      expectedConfirmation: input.expectedConfirmation,
      now: this.clock.now(),
      windowMs: this.recentAuthWindowMs,
    })
  }

  sessionCookie(session: SessionRecord, token: string): string {
    const ttlMs = new Date(session.expiresAt).getTime() - this.clock.now().getTime()
    return buildSessionCookie(sessionCookiePolicyFor(session.relyingParty), token, {
      maxAgeSeconds: Math.max(0, Math.floor(ttlMs / 1000)),
      expires: new Date(session.expiresAt),
    })
  }

  close(): void {
    this.store.close()
  }

  private createSession(params: CreateSessionParams): IssuedSession {
    const { issued, record } = this.buildSession(params)
    this.store.createSession(record)
    return issued
  }

  private replaceSession(previous: SessionRecord, params: CreateSessionParams): IssuedSession {
    const { issued, record } = this.buildSession({ ...params, rotatedFrom: previous.sessionId })
    // Atomic swap: revoke the previous session and insert the replacement in one
    // store transaction so a failure cannot leave both sessions live.
    this.store.rotateSession(previous.sessionId, record, this.clock.now().toISOString())
    return issued
  }

  private buildSession(params: CreateSessionParams): {
    issued: IssuedSession
    record: SessionRecord
  } {
    const issuer = params.relyingParty === 'navin-mail' ? this.mailIssuer : this.controlIssuer
    const issuedAt = this.clock.now().toISOString()
    const sessionId = `ses_${toBase64Url(this.random.bytes(24))}`
    const principal: SessionPrincipal = {
      userId: params.user.userId,
      accountId: params.user.accountId,
      email: params.user.email,
      roles: params.roles,
      scopes: params.scopes,
    }
    const { token, payload } = issuer.issue({
      sessionId,
      principal,
      surface: params.surface,
      assuranceLevel: params.assuranceLevel,
      lastAuthenticatedAt: params.lastAuthenticatedAt,
      mailboxId: params.mailboxId,
      issuedAt,
    })
    const csrfSecret = this.random.bytes(32)
    const record: SessionRecord = {
      sessionId,
      userId: params.user.userId,
      accountId: params.user.accountId,
      email: params.user.email,
      roles: params.roles,
      scopes: params.scopes,
      relyingParty: params.relyingParty,
      surface: params.surface,
      assuranceLevel: params.assuranceLevel,
      issuedAt,
      lastAuthenticatedAt: params.lastAuthenticatedAt,
      expiresAt: payload.expiresAt,
      tokenHash: sha256Hex(token),
      csrfSecret: toBase64Url(csrfSecret),
    }
    if (params.mailboxId) {
      record.mailboxId = params.mailboxId
    }
    if (params.rotatedFrom) {
      record.rotatedFrom = params.rotatedFrom
    }
    if (params.userAgent) {
      record.userAgent = params.userAgent
    }
    if (params.ipAddress) {
      record.ipAddress = params.ipAddress
    }

    return {
      record,
      issued: {
        sessionId,
        token,
        csrfToken: deriveCsrfToken(sessionId, csrfSecret),
        cookie: buildSessionCookie(sessionCookiePolicyFor(params.relyingParty), token, {
          maxAgeSeconds: Math.floor(issuer.ttlMs / 1000),
          expires: new Date(payload.expiresAt),
        }),
        principal,
        relyingParty: params.relyingParty,
        surface: params.surface,
        assuranceLevel: params.assuranceLevel,
        mailboxId: params.mailboxId,
        issuedAt,
        lastAuthenticatedAt: params.lastAuthenticatedAt,
        expiresAt: payload.expiresAt,
      },
    }
  }

  private assertActive(session: SessionRecord): void {
    if (session.revokedAt) {
      throw new AuthError('SESSION_REVOKED')
    }
    if (new Date(session.expiresAt).getTime() <= this.clock.now().getTime()) {
      throw new AuthError('TOKEN_EXPIRED')
    }
  }

  private requireActiveSession(sessionId: string): SessionRecord {
    const session = this.store.getSession(sessionId)
    if (!session) {
      throw new AuthError('SESSION_NOT_FOUND')
    }
    this.assertActive(session)
    return session
  }

  private requireUser(userId: string): UserRecord {
    const user = this.store.getUserById(userId)
    if (!user || user.disabled) {
      throw new AuthError('INVALID_CREDENTIALS')
    }
    return user
  }

  private assertSurfaceForRelyingParty(relyingParty: RelyingParty, surface: Surface): void {
    if (!isSurface(surface) || !surfacesForRelyingParty(relyingParty).includes(surface)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'surface_not_valid_for_relying_party' })
    }
  }

  /**
   * Fixed dummy verifier used when the account is unknown. Computed once (lazily)
   * so the unknown-account path performs the same scrypt work as a real check.
   */
  private getDummyVerifier(): string {
    if (!this.dummyVerifier) {
      this.dummyVerifier =
        this.configuredDummyVerifier ??
        hashPassword(toBase64Url(this.random.bytes(32)), { random: this.random })
    }
    return this.dummyVerifier
  }

  private audit(type: AuthAuditType, details: Omit<AuthAuditEvent, 'type' | 'at'>): void {
    const event: AuthAuditEvent = { type, at: this.clock.now().toISOString(), ...details }
    try {
      this.auditSink?.(event)
    } catch {
      // Audit sinks must never break an auth decision.
    }
  }
}

function normalizeEmail(email: string): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}
