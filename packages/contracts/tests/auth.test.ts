import { describe, it, expect } from 'vitest'
import {
  NavinRelyingPartySchema,
  NavinRoleSchema,
  AuthScopeSchema,
  SessionAssuranceLevelSchema,
  SessionTokenPayloadSchema,
  CookieSecurityPolicySchema,
  validate,
  isValid,
} from '../src/index.js'

describe('Auth & Session Contracts', () => {
  it('validates relying parties and session assurance levels', () => {
    expect(isValid(NavinRelyingPartySchema, 'navin-mail')).toBe(true)
    expect(isValid(NavinRelyingPartySchema, 'navin-control')).toBe(true)
    expect(isValid(NavinRelyingPartySchema, 'navin-public')).toBe(false)

    expect(isValid(SessionAssuranceLevelSchema, 'standard')).toBe(true)
    expect(isValid(SessionAssuranceLevelSchema, 'mfa_verified')).toBe(true)
    expect(isValid(SessionAssuranceLevelSchema, 'step_up_recent')).toBe(true)
    expect(isValid(SessionAssuranceLevelSchema, 'root')).toBe(false)
  })

  it('validates scoped roles from the product plan', () => {
    expect(isValid(NavinRoleSchema, 'mail.user')).toBe(true)
    expect(isValid(NavinRoleSchema, 'ops.super_admin')).toBe(true)
    expect(isValid(NavinRoleSchema, 'org.user_admin')).toBe(true)
    expect(isValid(NavinRoleSchema, 'admin')).toBe(false) // undifferentiated admin rejected
  })

  it('validates a well-formed session token payload', () => {
    const validPayload = {
      sessionId: 'ses_01HXYZ1234',
      principal: {
        userId: 'usr_operator1',
        accountId: 'acc_mainorg',
        email: 'operator@example.com',
        roles: ['ops.operator', 'org.domain_admin'],
        scopes: ['control:discover', 'control:plan', 'control:apply'],
      },
      relyingParty: 'navin-control',
      surface: 'control',
      assuranceLevel: 'mfa_verified',
      issuedAt: '2026-10-01T10:00:00.000Z',
      expiresAt: '2026-10-01T12:00:00.000Z',
      lastAuthenticatedAt: '2026-10-01T10:00:00.000Z',
    }

    expect(isValid(SessionTokenPayloadSchema, validPayload)).toBe(true)
    const res = validate(SessionTokenPayloadSchema, validPayload)
    expect(res.success).toBe(true)
  })

  it('validates auth scope strings', () => {
    expect(isValid(AuthScopeSchema, 'mail:read')).toBe(true)
    expect(isValid(AuthScopeSchema, 'control:plan')).toBe(true)
    expect(isValid(AuthScopeSchema, 'admin:users.*')).toBe(true)
    expect(isValid(AuthScopeSchema, 'no_colon_scope')).toBe(false)
    expect(isValid(AuthScopeSchema, '')).toBe(false)
  })

  it('strictly enforces relyingParty and surface pairing in SessionTokenPayload', () => {
    const basePrincipal = {
      userId: 'usr_01HXYZ',
      accountId: 'acc_01HXYZ',
      email: 'user@example.com',
      roles: ['mail.user'],
      scopes: ['mail:read'],
    }
    const baseDates = {
      issuedAt: '2026-10-01T10:00:00.000Z',
      expiresAt: '2026-10-01T12:00:00.000Z',
      lastAuthenticatedAt: '2026-10-01T10:00:00.000Z',
    }

    // navin-mail with mail: VALID
    expect(
      isValid(SessionTokenPayloadSchema, {
        sessionId: 'ses_01HXYZ',
        principal: basePrincipal,
        relyingParty: 'navin-mail',
        surface: 'mail',
        assuranceLevel: 'standard',
        ...baseDates,
      }),
    ).toBe(true)

    // navin-mail with control: REJECTED (isolated mismatch)
    expect(
      isValid(SessionTokenPayloadSchema, {
        sessionId: 'ses_01HXYZ',
        principal: basePrincipal,
        relyingParty: 'navin-mail',
        surface: 'control',
        assuranceLevel: 'standard',
        ...baseDates,
      }),
    ).toBe(false)

    // navin-mail with cli: REJECTED (isolated mismatch)
    expect(
      isValid(SessionTokenPayloadSchema, {
        sessionId: 'ses_01HXYZ',
        principal: basePrincipal,
        relyingParty: 'navin-mail',
        surface: 'cli',
        assuranceLevel: 'standard',
        ...baseDates,
      }),
    ).toBe(false)

    // navin-control with control: VALID
    expect(
      isValid(SessionTokenPayloadSchema, {
        sessionId: 'ses_01HXYZ',
        principal: basePrincipal,
        relyingParty: 'navin-control',
        surface: 'control',
        assuranceLevel: 'mfa_verified',
        ...baseDates,
      }),
    ).toBe(true)

    // navin-control with cli: VALID
    expect(
      isValid(SessionTokenPayloadSchema, {
        sessionId: 'ses_01HXYZ',
        principal: basePrincipal,
        relyingParty: 'navin-control',
        surface: 'cli',
        assuranceLevel: 'mfa_verified',
        ...baseDates,
      }),
    ).toBe(true)

    // navin-control with mail: REJECTED (isolated mismatch)
    expect(
      isValid(SessionTokenPayloadSchema, {
        sessionId: 'ses_01HXYZ',
        principal: basePrincipal,
        relyingParty: 'navin-control',
        surface: 'mail',
        assuranceLevel: 'mfa_verified',
        ...baseDates,
      }),
    ).toBe(false)
  })

  it('rejects invalid session token payload and validates cookie security policy', () => {
    const mismatchedPayload = {
      sessionId: '', // Empty session ID should be rejected
      principal: {
        userId: 'usr_user1',
        accountId: 'acc_mainorg',
        email: 'invalid-email-address', // Invalid email format
        roles: ['mail.user'],
        scopes: ['mail:read'],
      },
      relyingParty: 'navin-control',
      surface: 'mail',
      assuranceLevel: 'standard',
      issuedAt: '2026-10-01T10:00:00.000Z',
      expiresAt: '2026-10-01T12:00:00.000Z',
      lastAuthenticatedAt: '2026-10-01T10:00:00.000Z',
    }
    expect(isValid(SessionTokenPayloadSchema, mismatchedPayload)).toBe(false)

    // Let's test that CookieSecurityPolicy enforces host-only, secure, httpOnly
    const validCookiePolicy = {
      name: '__Host-navin-session',
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      hostOnly: true,
    }
    expect(isValid(CookieSecurityPolicySchema, validCookiePolicy)).toBe(true)

    const insecureCookiePolicy = {
      name: 'session',
      secure: false, // Insecure rejected
      httpOnly: true,
      sameSite: 'lax',
      hostOnly: false,
    }
    expect(isValid(CookieSecurityPolicySchema, insecureCookiePolicy)).toBe(false)
  })
})
