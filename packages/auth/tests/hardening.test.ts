import { describe, expect, it } from 'vitest'
import { AuthError } from '../src/errors.js'
import { createMailIssuer, MAX_TOKEN_TTL_MS } from '../src/issuers.js'
import { hashPassword, verifyPassword } from '../src/password.js'
import { signToken } from '../src/tokens.js'
import type { SessionPrincipal } from '../src/types.js'
import { sha256Hex } from '../src/encoding.js'
import type { SessionRecord as StoreSession } from '../src/store/store.js'
import { ADMIN_PASSWORD, createHarness, MAIL_KEY, seedAdmin, type Harness } from './helpers.js'

const PRINCIPAL: SessionPrincipal = {
  userId: 'usr_operator1',
  accountId: 'acc_mainorg',
  email: 'operator@example.com',
  roles: ['ops.operator'],
  scopes: ['control:plan'],
}

describe('bounded password parsing', () => {
  it('rejects over-limit or malformed scrypt parameters without computing', () => {
    // N exceeds maxN / has too many digits
    expect(
      verifyPassword(
        'password value',
        'scrypt$1073741824$8$1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBe(false)
    // N is not a power of two
    expect(
      verifyPassword(
        'password value',
        'scrypt$3$8$1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBe(false)
    // r out of range
    expect(
      verifyPassword(
        'password value',
        'scrypt$1024$0$1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBe(false)
    // non-decimal N
    expect(
      verifyPassword(
        'password value',
        'scrypt$1e9$8$1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBe(false)
    // truncated verifier
    expect(verifyPassword('password value', 'scrypt$1024$8$1$AAAA')).toBe(false)
  })

  it('rejects over-length passwords and over-length encoded verifiers', () => {
    const verifier = hashPassword('password value', { params: { N: 1024, r: 8, p: 1 } })
    expect(verifyPassword('a'.repeat(5000), verifier)).toBe(false)
    expect(verifyPassword('password value', `scrypt$1024$8$1$${'A'.repeat(600)}`)).toBe(false)
  })

  it('refuses to hash with invalid scrypt parameters', () => {
    expect(() => hashPassword('password value', { params: { N: 3 } })).toThrowError(AuthError)
    expect(() => hashPassword('password value', { params: { N: 1 << 25 } })).toThrowError(AuthError)
    expect(() => hashPassword('password value', { params: { r: 0 } })).toThrowError(AuthError)
  })
})

describe('bounded token and TTL handling', () => {
  function issue(h: Harness, ttlMs: number) {
    return h.mailIssuer.issue({
      sessionId: 'ses_bounds',
      principal: PRINCIPAL,
      surface: 'mail',
      assuranceLevel: 'standard',
      lastAuthenticatedAt: h.clock.now().toISOString(),
      ttlMs,
    })
  }

  it('rejects oversized tokens before parsing', () => {
    const h = createHarness()
    const oversized = `${'a'.repeat(4000)}.${'b'.repeat(4000)}.${'c'.repeat(1000)}`
    try {
      h.controlIssuer.verify(oversized)
      throw new Error('expected verify to throw')
    } catch (error) {
      expect((error as AuthError).code).toBe('INVALID_TOKEN')
    }
  })

  it('rejects a correctly-signed token whose payload shape is invalid', () => {
    const h = createHarness()
    const token = signToken(
      {
        sessionId: 'ses_bad',
        relyingParty: 'navin-mail',
        surface: 'mail',
        assuranceLevel: 'standard',
        issuedAt: h.clock.now().toISOString(),
        expiresAt: new Date(h.clock.now().getTime() + 60000).toISOString(),
        lastAuthenticatedAt: h.clock.now().toISOString(),
        // principal intentionally omitted
      },
      MAIL_KEY,
      { alg: 'HS256', typ: 'NAVIN', kid: 'mail-1', iss: 'navin-identity', aud: 'navin-mail' },
    )
    try {
      h.mailIssuer.verify(token)
      throw new Error('expected verify to throw')
    } catch (error) {
      expect((error as AuthError).code).toBe('INVALID_TOKEN')
    }
  })

  it('rejects non-finite, non-positive and over-limit TTLs', () => {
    const h = createHarness()
    expect(() => issue(h, -1)).toThrowError(AuthError)
    expect(() => issue(h, 0)).toThrowError(AuthError)
    expect(() => issue(h, Number.POSITIVE_INFINITY)).toThrowError(AuthError)
    expect(() => issue(h, MAX_TOKEN_TTL_MS + 1)).toThrowError(AuthError)
    expect(() => issue(h, 60_000)).not.toThrow()
  })

  it('rejects an invalid issuer TTL configuration', () => {
    const h = createHarness()
    expect(() => createMailIssuer({ key: MAIL_KEY, clock: h.clock, tokenTtlMs: 0 })).toThrowError(
      AuthError,
    )
    expect(() =>
      createMailIssuer({ key: MAIL_KEY, clock: h.clock, tokenTtlMs: MAX_TOKEN_TTL_MS + 1 }),
    ).toThrowError(AuthError)
  })
})

describe('login user-enumeration resistance', () => {
  it('performs a password verification for unknown and disabled accounts', () => {
    const hashes: string[] = []
    const h = createHarness({
      passwordVerifier: (password, encoded) => {
        hashes.push(encoded)
        return verifyPassword(password, encoded)
      },
    })
    seedAdmin(h)
    h.store.setUserDisabled('usr_admin1', true)

    hashes.length = 0
    expect(() =>
      h.service.login({
        email: 'ghost@example.com',
        password: 'a reasonable password',
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    ).toThrowError(/Invalid credentials/)
    expect(hashes).toHaveLength(1)
    const dummyVerifier = hashes[0]

    hashes.length = 0
    expect(() =>
      h.service.login({
        email: 'admin@example.com',
        password: ADMIN_PASSWORD,
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    ).toThrowError(/Invalid credentials/)
    expect(hashes).toHaveLength(1)
    // Disabled accounts verify their real stored verifier, not the dummy.
    expect(hashes[0]).not.toBe(dummyVerifier)
  })

  it('uses one stable dummy verifier across unknown-account attempts', () => {
    const hashes: string[] = []
    const h = createHarness({
      passwordVerifier: (_password, encoded) => {
        hashes.push(encoded)
        return false
      },
    })
    for (const email of ['a@example.com', 'b@example.com']) {
      expect(() =>
        h.service.login({
          email,
          password: 'a reasonable password',
          relyingParty: 'navin-control',
          surface: 'control',
        }),
      ).toThrowError(/Invalid credentials/)
    }
    expect(hashes).toHaveLength(2)
    expect(hashes[0]).toBe(hashes[1])
  })

  it('returns the same generic error code for unknown, disabled and wrong-password', () => {
    const h = createHarness()
    seedAdmin(h)
    const codes: string[] = []
    const capture = (fn: () => unknown) => {
      try {
        fn()
      } catch (error) {
        codes.push((error as AuthError).code)
      }
    }
    capture(() =>
      h.service.login({
        email: 'ghost@example.com',
        password: 'a reasonable password',
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    )
    capture(() =>
      h.service.login({
        email: 'admin@example.com',
        password: 'wrong password value',
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    )
    h.store.setUserDisabled('usr_admin1', true)
    capture(() =>
      h.service.login({
        email: 'admin@example.com',
        password: ADMIN_PASSWORD,
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    )
    expect(codes).toEqual(['INVALID_CREDENTIALS', 'INVALID_CREDENTIALS', 'INVALID_CREDENTIALS'])
  })
})

describe('session validation binds to the current user and signed payload', () => {
  function controlLogin(h: Harness) {
    return h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
  }

  it('rejects a live session once the user is disabled', () => {
    const h = createHarness()
    const userId = seedAdmin(h)
    const login = controlLogin(h)
    expect(
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }).sessionId,
    ).toBe(login.sessionId)
    h.store.setUserDisabled(userId, true)
    try {
      h.service.validate({ token: login.token, relyingParty: 'navin-control' })
      throw new Error('expected validate to throw')
    } catch (error) {
      expect((error as AuthError).code).toBe('ACCOUNT_DISABLED')
    }
  })

  it('rejects a session whose user no longer exists', () => {
    const h = createHarness()
    const { token, payload } = h.controlIssuer.issue({
      sessionId: 'ses_ghost',
      principal: {
        userId: 'usr_ghost',
        accountId: 'acc_mainorg',
        email: 'ghost@example.com',
        roles: ['ops.super_admin'],
        scopes: ['control:plan'],
      },
      surface: 'control',
      assuranceLevel: 'standard',
      lastAuthenticatedAt: h.clock.now().toISOString(),
    })
    const record: StoreSession = {
      sessionId: 'ses_ghost',
      userId: 'usr_ghost',
      accountId: 'acc_mainorg',
      email: 'ghost@example.com',
      roles: ['ops.super_admin'],
      scopes: ['control:plan'],
      relyingParty: 'navin-control',
      surface: 'control',
      assuranceLevel: 'standard',
      issuedAt: payload.issuedAt,
      lastAuthenticatedAt: payload.lastAuthenticatedAt,
      expiresAt: payload.expiresAt,
      tokenHash: sha256Hex(token),
      csrfSecret: 'AAAAAAAAAAAAAAAAAAAAAA',
    }
    h.store.createSession(record)
    try {
      h.service.validate({ token, relyingParty: 'navin-control' })
      throw new Error('expected validate to throw')
    } catch (error) {
      expect((error as AuthError).code).toBe('ACCOUNT_DISABLED')
    }
  })

  it('rejects a stored session tampered to another relying party, surface, user or account', () => {
    const h = createHarness()
    seedAdmin(h)
    const login = controlLogin(h)
    const original = h.store.getSession(login.sessionId) as StoreSession

    h.store.updateSession({ ...original, relyingParty: 'navin-mail' })
    expect(() =>
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }),
    ).toThrowError(/not issued for this relying party/)

    h.store.updateSession({ ...original, surface: 'cli' })
    expect(() =>
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }),
    ).toThrowError(/not permitted/)

    h.store.updateSession({ ...original, userId: 'usr_other' })
    expect(() =>
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }),
    ).toThrowError(/Invalid session token/)

    h.store.updateSession({ ...original, accountId: 'acc_other' })
    expect(() =>
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }),
    ).toThrowError(/Invalid session token/)
  })
})
