import { describe, expect, it } from 'vitest'
import { FixedClock } from '../src/clock.js'
import { AuthError } from '../src/errors.js'
import { createControlIssuer, createMailIssuer, CONTROL_SESSION_TTL_MS } from '../src/issuers.js'
import type { SessionPrincipal } from '../src/types.js'

const KEY_MAIL = new Uint8Array(32).fill(0x11)
const KEY_CONTROL = new Uint8Array(32).fill(0x22)

const PRINCIPAL: SessionPrincipal = {
  userId: 'usr_operator1',
  accountId: 'acc_mainorg',
  email: 'operator@example.com',
  roles: ['ops.operator'],
  scopes: ['control:discover', 'control:apply'],
}

function mailIssuer(clock: FixedClock) {
  return createMailIssuer({ key: KEY_MAIL, clock })
}
function controlIssuer(clock: FixedClock) {
  return createControlIssuer({ key: KEY_CONTROL, clock })
}

describe('separate Mail and Control issuers/audiences', () => {
  it('issues and verifies a Mail session token', () => {
    const clock = new FixedClock('2026-10-01T10:00:00.000Z')
    const issuer = mailIssuer(clock)
    const { token } = issuer.issue({
      sessionId: 'ses_mail1',
      principal: PRINCIPAL,
      surface: 'mail',
      assuranceLevel: 'standard',
      lastAuthenticatedAt: clock.now().toISOString(),
    })
    const payload = issuer.verify(token)
    expect(payload.relyingParty).toBe('navin-mail')
    expect(payload.surface).toBe('mail')
  })

  it('issues Control tokens for control and cli surfaces', () => {
    const clock = new FixedClock('2026-10-01T10:00:00.000Z')
    const issuer = controlIssuer(clock)
    for (const surface of ['control', 'cli'] as const) {
      const { token } = issuer.issue({
        sessionId: `ses_${surface}`,
        principal: PRINCIPAL,
        surface,
        assuranceLevel: 'mfa_verified',
        lastAuthenticatedAt: clock.now().toISOString(),
      })
      expect(issuer.verify(token).relyingParty).toBe('navin-control')
    }
  })

  it('refuses a Mail token at the Control verifier (audience isolation)', () => {
    const clock = new FixedClock('2026-10-01T10:00:00.000Z')
    const { token } = mailIssuer(clock).issue({
      sessionId: 'ses_mail1',
      principal: PRINCIPAL,
      surface: 'mail',
      assuranceLevel: 'standard',
      lastAuthenticatedAt: clock.now().toISOString(),
    })
    expect(() => controlIssuer(clock).verify(token)).toThrowError(AuthError)
    try {
      controlIssuer(clock).verify(token)
    } catch (error) {
      expect((error as AuthError).code).toBe('WRONG_AUDIENCE')
    }
  })

  it('refuses a Control token at the Mail verifier', () => {
    const clock = new FixedClock('2026-10-01T10:00:00.000Z')
    const { token } = controlIssuer(clock).issue({
      sessionId: 'ses_control1',
      principal: PRINCIPAL,
      surface: 'control',
      assuranceLevel: 'standard',
      lastAuthenticatedAt: clock.now().toISOString(),
    })
    try {
      mailIssuer(clock).verify(token)
      throw new Error('expected verify to throw')
    } catch (error) {
      expect((error as AuthError).code).toBe('WRONG_AUDIENCE')
    }
  })

  it('rejects a token signed with a different key', () => {
    const clock = new FixedClock('2026-10-01T10:00:00.000Z')
    const other = createMailIssuer({ key: new Uint8Array(32).fill(0x99), clock })
    const { token } = mailIssuer(clock).issue({
      sessionId: 'ses_mail1',
      principal: PRINCIPAL,
      surface: 'mail',
      assuranceLevel: 'standard',
      lastAuthenticatedAt: clock.now().toISOString(),
    })
    expect(() => other.verify(token)).toThrowError(/Invalid session token/)
  })

  it('detects tampered tokens', () => {
    const clock = new FixedClock('2026-10-01T10:00:00.000Z')
    const issuer = mailIssuer(clock)
    const { token } = issuer.issue({
      sessionId: 'ses_mail1',
      principal: PRINCIPAL,
      surface: 'mail',
      assuranceLevel: 'standard',
      lastAuthenticatedAt: clock.now().toISOString(),
    })
    const [header, payload, signature] = token.split('.') as [string, string, string]
    const tampered = `${header}.${payload}.${signature.slice(0, -2)}xx`
    expect(() => issuer.verify(tampered)).toThrowError(/Invalid session token/)
    expect(() => issuer.verify('garbage')).toThrowError(/Invalid session token/)
  })

  it('expires Control tokens after their shorter TTL', () => {
    const clock = new FixedClock('2026-10-01T10:00:00.000Z')
    const issuer = controlIssuer(clock)
    const { token } = issuer.issue({
      sessionId: 'ses_control1',
      principal: PRINCIPAL,
      surface: 'control',
      assuranceLevel: 'standard',
      lastAuthenticatedAt: clock.now().toISOString(),
    })
    clock.advance(CONTROL_SESSION_TTL_MS + 1000)
    try {
      issuer.verify(token)
      throw new Error('expected verify to throw')
    } catch (error) {
      expect((error as AuthError).code).toBe('TOKEN_EXPIRED')
    }
  })

  it('rejects a surface that the issuer does not serve', () => {
    const clock = new FixedClock('2026-10-01T10:00:00.000Z')
    expect(() =>
      mailIssuer(clock).issue({
        sessionId: 'ses_x',
        principal: PRINCIPAL,
        surface: 'control',
        assuranceLevel: 'standard',
        lastAuthenticatedAt: clock.now().toISOString(),
      }),
    ).toThrowError(/validation/i)
  })

  it('requires a sufficiently long issuer key', () => {
    const clock = new FixedClock('2026-10-01T10:00:00.000Z')
    expect(() => createMailIssuer({ key: new Uint8Array(8), clock })).toThrowError(AuthError)
  })
})
