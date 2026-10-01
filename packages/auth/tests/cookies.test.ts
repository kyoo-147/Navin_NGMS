import { describe, expect, it } from 'vitest'
import {
  assertCookiePolicy,
  buildClearedSessionCookie,
  buildSessionCookie,
  CONTROL_SESSION_COOKIE,
  MAIL_SESSION_COOKIE,
  isHostCookieName,
  sessionCookiePolicyFor,
} from '../src/cookies.js'
import type { CookiePolicy } from '../src/types.js'

describe('__Host- session cookies', () => {
  it('defines distinct Mail and Control host-only cookie policies', () => {
    expect(MAIL_SESSION_COOKIE.name).toBe('__Host-navin_mail_session')
    expect(CONTROL_SESSION_COOKIE.name).toBe('__Host-navin_control_session')
    expect(MAIL_SESSION_COOKIE.name).not.toBe(CONTROL_SESSION_COOKIE.name)
    for (const policy of [MAIL_SESSION_COOKIE, CONTROL_SESSION_COOKIE]) {
      expect(policy.secure).toBe(true)
      expect(policy.httpOnly).toBe(true)
      expect(policy.hostOnly).toBe(true)
      expect(policy.name.startsWith('__Host-')).toBe(true)
      expect(() => assertCookiePolicy(policy)).not.toThrow()
    }
    expect(MAIL_SESSION_COOKIE.sameSite).toBe('lax')
    expect(CONTROL_SESSION_COOKIE.sameSite).toBe('strict')
  })

  it('selects the cookie policy per relying party', () => {
    expect(sessionCookiePolicyFor('navin-mail')).toBe(MAIL_SESSION_COOKIE)
    expect(sessionCookiePolicyFor('navin-control')).toBe(CONTROL_SESSION_COOKIE)
  })

  it('serializes a host-only cookie without a Domain attribute', () => {
    const cookie = buildSessionCookie(MAIL_SESSION_COOKIE, 'opaque-token-value', {
      maxAgeSeconds: 3600,
      expires: new Date('2026-10-01T11:00:00.000Z'),
    })
    expect(cookie).toContain('__Host-navin_mail_session=opaque-token-value')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Max-Age=3600')
    expect(cookie).not.toContain('Domain')
  })

  it('uses SameSite=Strict for the Control cookie', () => {
    const cookie = buildSessionCookie(CONTROL_SESSION_COOKIE, 'token', { maxAgeSeconds: 60 })
    expect(cookie).toContain('SameSite=Strict')
  })

  it('clears a session cookie with Max-Age=0', () => {
    const cookie = buildClearedSessionCookie(MAIL_SESSION_COOKIE)
    expect(cookie).toContain('__Host-navin_mail_session=')
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).not.toContain('Domain')
  })

  it('rejects weakening cookie policies', () => {
    const badName = { ...MAIL_SESSION_COOKIE, name: 'navin_session' } as CookiePolicy
    expect(() => assertCookiePolicy(badName)).toThrowError(/validation/i)
    const notSecure = { ...MAIL_SESSION_COOKIE, secure: false } as unknown as CookiePolicy
    expect(() => assertCookiePolicy(notSecure)).toThrow()
    const notHttpOnly = { ...MAIL_SESSION_COOKIE, httpOnly: false } as unknown as CookiePolicy
    expect(() => assertCookiePolicy(notHttpOnly)).toThrow()
    expect(isHostCookieName('__Host-x')).toBe(true)
    expect(isHostCookieName('__Host-')).toBe(false)
    expect(isHostCookieName('session')).toBe(false)
  })
})
