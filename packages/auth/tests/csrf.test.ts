import { describe, expect, it } from 'vitest'
import {
  assertStateChangingRequest,
  deriveCsrfToken,
  verifyCsrfToken,
  verifyOrigin,
} from '../src/csrf.js'

const SECRET = new Uint8Array(32).fill(7)
const ORIGINS = ['https://control.example.com']

describe('CSRF and origin defenses', () => {
  it('derives a deterministic session-bound CSRF token', () => {
    const a = deriveCsrfToken('ses_a', SECRET)
    const b = deriveCsrfToken('ses_a', SECRET)
    const c = deriveCsrfToken('ses_b', SECRET)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(deriveCsrfToken('ses_a', new Uint8Array(32).fill(8))).not.toBe(a)
  })

  it('verifies only the matching CSRF token', () => {
    const token = deriveCsrfToken('ses_a', SECRET)
    expect(verifyCsrfToken(token, 'ses_a', SECRET)).toBe(true)
    expect(verifyCsrfToken(token, 'ses_b', SECRET)).toBe(false)
    expect(verifyCsrfToken('nope', 'ses_a', SECRET)).toBe(false)
    expect(verifyCsrfToken(undefined, 'ses_a', SECRET)).toBe(false)
  })

  it('requires an exact allowlisted origin', () => {
    expect(verifyOrigin({ origin: 'https://control.example.com' }, ORIGINS)).toBe(true)
    expect(verifyOrigin({ origin: 'https://evil.example.com' }, ORIGINS)).toBe(false)
    expect(verifyOrigin({ origin: 'https://control.example.com.evil.com' }, ORIGINS)).toBe(false)
    expect(verifyOrigin({ referer: 'https://control.example.com/setup' }, ORIGINS)).toBe(true)
    expect(verifyOrigin({ origin: null, referer: null }, ORIGINS)).toBe(false)
    expect(verifyOrigin({ origin: 'https://control.example.com' }, [])).toBe(false)
  })

  it('lets safe methods through and fails state-changing requests closed', () => {
    const token = deriveCsrfToken('ses_a', SECRET)
    expect(() =>
      assertStateChangingRequest({
        method: 'GET',
        sessionId: 'ses_a',
        csrfSecret: SECRET,
        allowedOrigins: ORIGINS,
      }),
    ).not.toThrow()

    expect(() =>
      assertStateChangingRequest({
        method: 'POST',
        sessionId: 'ses_a',
        csrfSecret: SECRET,
        csrfToken: token,
        origin: 'https://evil.example.com',
        allowedOrigins: ORIGINS,
      }),
    ).toThrowError(/origin/i)

    expect(() =>
      assertStateChangingRequest({
        method: 'POST',
        sessionId: 'ses_a',
        csrfSecret: SECRET,
        csrfToken: 'wrong',
        origin: 'https://control.example.com',
        allowedOrigins: ORIGINS,
      }),
    ).toThrowError(/Cross-site request verification failed/)

    expect(() =>
      assertStateChangingRequest({
        method: 'POST',
        sessionId: 'ses_a',
        csrfSecret: SECRET,
        csrfToken: token,
        origin: 'https://control.example.com',
        allowedOrigins: ORIGINS,
      }),
    ).not.toThrow()
  })
})
