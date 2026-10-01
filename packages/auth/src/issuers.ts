import type { Clock } from './clock.js'
import { AuthError } from './errors.js'
import { decodeToken, signToken, verifyTokenSignature } from './tokens.js'
import {
  audienceForRelyingParty,
  isNavinRole,
  isSurface,
  surfacesForRelyingParty,
  SESSION_ASSURANCE_LEVELS,
  type AssuranceLevel,
  type SessionPrincipal,
  type SessionTokenPayload,
  type RelyingParty,
  type Surface,
} from './types.js'

export const DEFAULT_ISSUER = 'navin-identity'
export const MAIL_SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const CONTROL_SESSION_TTL_MS = 30 * 60 * 1000
export const MIN_TOKEN_TTL_MS = 1000
export const MAX_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const CLOCK_SKEW_MS = 60 * 1000

export interface IssuerConfig {
  issuer: string
  keyId: string
  key: Uint8Array
  relyingParty: RelyingParty
  clock: Clock
  tokenTtlMs: number
}

export interface IssueInput {
  sessionId: string
  principal: SessionPrincipal
  surface: Surface
  assuranceLevel: AssuranceLevel
  lastAuthenticatedAt: string
  mailboxId?: string
  issuedAt?: string
  ttlMs?: number
}

export interface IssuedToken {
  token: string
  payload: SessionTokenPayload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function parseTime(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : undefined
}

function assertTtl(ttlMs: unknown): asserts ttlMs is number {
  if (
    typeof ttlMs !== 'number' ||
    !Number.isFinite(ttlMs) ||
    ttlMs < MIN_TOKEN_TTL_MS ||
    ttlMs > MAX_TOKEN_TTL_MS
  ) {
    throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_token_ttl' })
  }
}

function isValidPrincipal(value: unknown): value is SessionPrincipal {
  if (!isRecord(value)) {
    return false
  }
  if (
    !isBoundedString(value.userId, 1, 128) ||
    !isBoundedString(value.accountId, 1, 128) ||
    !isBoundedString(value.email, 3, 320)
  ) {
    return false
  }
  if (!Array.isArray(value.roles) || value.roles.length === 0 || value.roles.length > 32) {
    return false
  }
  if (!value.roles.every((role) => isNavinRole(role))) {
    return false
  }
  if (!Array.isArray(value.scopes) || value.scopes.length > 256) {
    return false
  }
  return value.scopes.every((scope) => isBoundedString(scope, 1, 128))
}

/**
 * A relying-party-bound token issuer. Each issuer owns a distinct signing key,
 * issuer name and audience, so a Mail token can never validate as a Control
 * token (and vice versa) even if an attacker can present one to the other
 * verifier.
 */
export class TokenIssuer {
  private readonly key: Uint8Array

  constructor(private readonly config: IssuerConfig) {
    if (!(config.key instanceof Uint8Array) || config.key.length < 32) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'issuer_key_too_short' })
    }
    assertTtl(config.tokenTtlMs)
    this.key = config.key
  }

  get relyingParty(): RelyingParty {
    return this.config.relyingParty
  }

  get audience(): string {
    return audienceForRelyingParty(this.config.relyingParty)
  }

  get issuerName(): string {
    return this.config.issuer
  }

  get ttlMs(): number {
    return this.config.tokenTtlMs
  }

  get surfaces(): Surface[] {
    return surfacesForRelyingParty(this.config.relyingParty)
  }

  issue(input: IssueInput): IssuedToken {
    if (!this.surfaces.includes(input.surface)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'surface_not_valid_for_issuer' })
    }
    if (!isBoundedString(input.sessionId, 1, 128)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_session_id' })
    }
    if (input.mailboxId !== undefined && !isBoundedString(input.mailboxId, 1, 128)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_mailbox_id' })
    }
    if (!SESSION_ASSURANCE_LEVELS.includes(input.assuranceLevel)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_assurance_level' })
    }
    if (!isValidPrincipal(input.principal)) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_principal' })
    }
    const ttlMs = input.ttlMs ?? this.config.tokenTtlMs
    assertTtl(ttlMs)

    const issuedAt = input.issuedAt ?? this.config.clock.now().toISOString()
    const issuedAtMs = parseTime(issuedAt)
    if (issuedAtMs === undefined) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_issued_at' })
    }
    if (parseTime(input.lastAuthenticatedAt) === undefined) {
      throw new AuthError('VALIDATION_FAILED', { reason: 'invalid_last_authenticated_at' })
    }
    const expiresAt = new Date(issuedAtMs + ttlMs).toISOString()

    const base = {
      sessionId: input.sessionId,
      principal: input.principal,
      relyingParty: this.config.relyingParty,
      surface: input.surface,
      assuranceLevel: input.assuranceLevel,
      issuedAt,
      expiresAt,
      lastAuthenticatedAt: input.lastAuthenticatedAt,
      ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
    }

    const payload = base as unknown as SessionTokenPayload
    const token = signToken(payload as unknown as Record<string, unknown>, this.key, {
      alg: 'HS256',
      typ: 'NAVIN',
      kid: this.config.keyId,
      iss: this.config.issuer,
      aud: this.audience,
    })
    return { token, payload }
  }

  verify(token: string): SessionTokenPayload {
    const decoded = decodeToken(token)
    if (decoded.header.aud !== this.audience) {
      throw new AuthError('WRONG_AUDIENCE')
    }
    if (decoded.header.iss !== this.config.issuer || decoded.header.kid !== this.config.keyId) {
      throw new AuthError('INVALID_TOKEN')
    }
    verifyTokenSignature(decoded, this.key)

    const payload = decoded.payload
    if (payload.relyingParty !== this.config.relyingParty) {
      throw new AuthError('WRONG_AUDIENCE')
    }
    if (!isSurface(payload.surface) || !this.surfaces.includes(payload.surface)) {
      throw new AuthError('WRONG_AUDIENCE')
    }
    this.assertValidPayload(payload)

    const now = this.config.clock.now().getTime()
    const expiresAt = parseTime(payload.expiresAt)!
    const issuedAt = parseTime(payload.issuedAt)!
    if (expiresAt <= now) {
      throw new AuthError('TOKEN_EXPIRED')
    }
    if (issuedAt - CLOCK_SKEW_MS > now) {
      throw new AuthError('INVALID_TOKEN')
    }
    return payload as unknown as SessionTokenPayload
  }

  private assertValidPayload(payload: Record<string, unknown>): void {
    const expiresAt = parseTime(payload.expiresAt)
    const issuedAt = parseTime(payload.issuedAt)
    const lastAuthenticatedAt = parseTime(payload.lastAuthenticatedAt)
    if (expiresAt === undefined || issuedAt === undefined || lastAuthenticatedAt === undefined) {
      throw new AuthError('INVALID_TOKEN')
    }
    if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TOKEN_TTL_MS) {
      throw new AuthError('INVALID_TOKEN')
    }
    if (!isBoundedString(payload.sessionId, 1, 128)) {
      throw new AuthError('INVALID_TOKEN')
    }
    if (
      !SESSION_ASSURANCE_LEVELS.includes(payload.assuranceLevel as AssuranceLevel) ||
      !isValidPrincipal(payload.principal)
    ) {
      throw new AuthError('INVALID_TOKEN')
    }
    if (payload.mailboxId !== undefined && !isBoundedString(payload.mailboxId, 1, 128)) {
      throw new AuthError('INVALID_TOKEN')
    }
  }
}

export function createMailIssuer(options: {
  key: Uint8Array
  clock: Clock
  issuer?: string
  keyId?: string
  tokenTtlMs?: number
}): TokenIssuer {
  return new TokenIssuer({
    issuer: options.issuer ?? DEFAULT_ISSUER,
    keyId: options.keyId ?? 'mail-1',
    key: options.key,
    relyingParty: 'navin-mail',
    clock: options.clock,
    tokenTtlMs: options.tokenTtlMs ?? MAIL_SESSION_TTL_MS,
  })
}

export function createControlIssuer(options: {
  key: Uint8Array
  clock: Clock
  issuer?: string
  keyId?: string
  tokenTtlMs?: number
}): TokenIssuer {
  return new TokenIssuer({
    issuer: options.issuer ?? DEFAULT_ISSUER,
    keyId: options.keyId ?? 'control-1',
    key: options.key,
    relyingParty: 'navin-control',
    clock: options.clock,
    tokenTtlMs: options.tokenTtlMs ?? CONTROL_SESSION_TTL_MS,
  })
}

export function isSessionTokenPayload(value: unknown): value is SessionTokenPayload {
  return (
    isRecord(value) &&
    isSurface(value.surface) &&
    isBoundedString(value.sessionId, 1, 128) &&
    isValidPrincipal(value.principal)
  )
}
