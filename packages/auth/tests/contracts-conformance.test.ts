import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  AuthScopeSchema,
  CookieSecurityPolicySchema,
  isValid,
  SessionPrincipalSchema,
  SessionTokenPayloadSchema,
} from '@navin/contracts'
import type {
  ControlSessionTokenPayload as ContractControlPayload,
  CookieSecurityPolicy as ContractCookiePolicy,
  MailSessionTokenPayload as ContractMailPayload,
  SessionPrincipal as ContractPrincipal,
} from '@navin/contracts'
import { CONTROL_SESSION_COOKIE, MAIL_SESSION_COOKIE } from '../src/cookies.js'
import { createControlIssuer, createMailIssuer } from '../src/issuers.js'
import { CONTROL_SCOPES, ORG_SCOPES, scopesForRoles } from '../src/rbac.js'
import { FixedClock } from '../src/clock.js'
import type {
  ControlSessionTokenPayload,
  CookiePolicy,
  MailSessionTokenPayload,
  SessionPrincipal,
} from '../src/types.js'

// Compile-time proof that the locally declared shapes remain a superset of the
// frozen contract shapes, so values from @navin/contracts are accepted here.
expectTypeOf<ContractPrincipal>().toMatchTypeOf<SessionPrincipal>()
expectTypeOf<ContractMailPayload>().toMatchTypeOf<MailSessionTokenPayload>()
expectTypeOf<ContractControlPayload>().toMatchTypeOf<ControlSessionTokenPayload>()
expectTypeOf<ContractCookiePolicy>().toMatchTypeOf<CookiePolicy>()

const PRINCIPAL: SessionPrincipal = {
  userId: 'usr_01HXYZ',
  accountId: 'acc_01HXYZ',
  email: 'operator@example.com',
  roles: ['ops.operator'],
  scopes: [CONTROL_SCOPES.discover, CONTROL_SCOPES.apply],
}

describe('conformance with frozen @navin/contracts', () => {
  const clock = new FixedClock('2026-10-01T10:00:00.000Z')

  it('issues Mail session payloads accepted by SessionTokenPayloadSchema', () => {
    const issuer = createMailIssuer({ key: new Uint8Array(32).fill(1), clock })
    const { payload } = issuer.issue({
      sessionId: 'ses_01HXYZ1234',
      principal: PRINCIPAL,
      surface: 'mail',
      assuranceLevel: 'standard',
      lastAuthenticatedAt: clock.now().toISOString(),
      mailboxId: 'mbx_01HXYZ',
    })
    expect(isValid(SessionTokenPayloadSchema, payload)).toBe(true)
    expect(isValid(SessionPrincipalSchema, payload.principal)).toBe(true)
  })

  it('issues Control session payloads (control and cli) accepted by the schema', () => {
    const issuer = createControlIssuer({ key: new Uint8Array(32).fill(2), clock })
    for (const surface of ['control', 'cli'] as const) {
      const { payload } = issuer.issue({
        sessionId: `ses_${surface}`,
        principal: PRINCIPAL,
        surface,
        assuranceLevel: 'mfa_verified',
        lastAuthenticatedAt: clock.now().toISOString(),
      })
      expect(isValid(SessionTokenPayloadSchema, payload)).toBe(true)
    }
  })

  it('matches cookie policies to CookieSecurityPolicySchema', () => {
    expect(isValid(CookieSecurityPolicySchema, MAIL_SESSION_COOKIE)).toBe(true)
    expect(isValid(CookieSecurityPolicySchema, CONTROL_SESSION_COOKIE)).toBe(true)
  })

  it('emits scopes that satisfy the contract scope pattern', () => {
    for (const scope of [
      ...Object.values(CONTROL_SCOPES),
      ...Object.values(ORG_SCOPES),
      ...scopesForRoles(['ops.super_admin'], 'navin-control'),
    ]) {
      expect(isValid(AuthScopeSchema, scope)).toBe(true)
    }
  })

  it('rejects a payload whose relying party and surface are mismatched', () => {
    const issuer = createMailIssuer({ key: new Uint8Array(32).fill(1), clock })
    const { payload } = issuer.issue({
      sessionId: 'ses_01HXYZ1234',
      principal: PRINCIPAL,
      surface: 'mail',
      assuranceLevel: 'standard',
      lastAuthenticatedAt: clock.now().toISOString(),
    })
    expect(isValid(SessionTokenPayloadSchema, { ...payload, relyingParty: 'navin-control' })).toBe(
      false,
    )
    expect(isValid(SessionTokenPayloadSchema, { ...payload, surface: 'control' })).toBe(false)
  })
})
