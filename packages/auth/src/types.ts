/**
 * Domain types for @navin/auth.
 *
 * These mirror the frozen `@navin/contracts` auth/session schemas
 * (`NavinRelyingPartySchema`, `NavinRoleSchema`, `AuthScopeSchema`,
 * `SessionAssuranceLevelSchema`, `SessionPrincipalSchema`,
 * `MailSessionTokenPayloadSchema`, `ControlSessionTokenPayloadSchema` and
 * `CookieSecurityPolicySchema`). They are declared locally so this package
 * ships with zero external runtime dependencies and requires no workspace
 * lockfile change; `tests/contracts-conformance.test.ts` proves the shapes
 * remain structurally compatible with the contracts package.
 */

export type RelyingParty = 'navin-mail' | 'navin-control'
export type Surface = 'mail' | 'control' | 'cli'
export type AssuranceLevel = 'none' | 'standard' | 'mfa_verified' | 'step_up_recent'

export type NavinRole =
  | 'mail.user'
  | 'mail.delegate'
  | 'org.support'
  | 'org.user_admin'
  | 'org.domain_admin'
  | 'ops.viewer'
  | 'ops.operator'
  | 'ops.security_admin'
  | 'ops.backup_admin'
  | 'ops.super_admin'
  | 'platform.developer'

export const NAVIN_ROLES: readonly NavinRole[] = [
  'mail.user',
  'mail.delegate',
  'org.support',
  'org.user_admin',
  'org.domain_admin',
  'ops.viewer',
  'ops.operator',
  'ops.security_admin',
  'ops.backup_admin',
  'ops.super_admin',
  'platform.developer',
]

export const SESSION_ASSURANCE_LEVELS: readonly AssuranceLevel[] = [
  'none',
  'standard',
  'mfa_verified',
  'step_up_recent',
]

/** Scoped permission token matching `^[a-z0-9_-]+:[a-z0-9_*.-]+$`. */
export type AuthScope = string

export interface SessionPrincipal {
  userId: string
  accountId: string
  email: string
  roles: NavinRole[]
  scopes: AuthScope[]
}

export interface MailSessionTokenPayload {
  sessionId: string
  principal: SessionPrincipal
  relyingParty: 'navin-mail'
  surface: 'mail'
  assuranceLevel: AssuranceLevel
  mailboxId?: string
  issuedAt: string
  expiresAt: string
  lastAuthenticatedAt: string
}

export interface ControlSessionTokenPayload {
  sessionId: string
  principal: SessionPrincipal
  relyingParty: 'navin-control'
  surface: 'control' | 'cli'
  assuranceLevel: AssuranceLevel
  mailboxId?: string
  issuedAt: string
  expiresAt: string
  lastAuthenticatedAt: string
}

export type SessionTokenPayload = MailSessionTokenPayload | ControlSessionTokenPayload

export interface CookiePolicy {
  name: string
  secure: true
  httpOnly: true
  sameSite: 'strict' | 'lax'
  hostOnly: true
}

const ASSURANCE_RANK: Record<AssuranceLevel, number> = {
  none: 0,
  standard: 1,
  mfa_verified: 2,
  step_up_recent: 3,
}

export function assuranceRank(level: AssuranceLevel): number {
  return ASSURANCE_RANK[level]
}

export function isRelyingParty(value: unknown): value is RelyingParty {
  return value === 'navin-mail' || value === 'navin-control'
}

export function isSurface(value: unknown): value is Surface {
  return value === 'mail' || value === 'control' || value === 'cli'
}

export function isNavinRole(value: unknown): value is NavinRole {
  return typeof value === 'string' && (NAVIN_ROLES as readonly string[]).includes(value)
}

export function audienceForRelyingParty(relyingParty: RelyingParty): string {
  return relyingParty
}

/** Mail tokens are mailbox-only; Control tokens cover the `control` and `cli` surfaces. */
export function surfacesForRelyingParty(relyingParty: RelyingParty): Surface[] {
  return relyingParty === 'navin-mail' ? ['mail'] : ['control', 'cli']
}
