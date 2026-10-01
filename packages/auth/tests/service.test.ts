import { describe, expect, it } from 'vitest'
import { AuthError } from '../src/errors.js'
import type { SessionRecord } from '../src/store/store.js'
import { ADMIN_PASSWORD, createHarness, MAIL_PASSWORD, seedAdmin, seedMailUser } from './helpers.js'

describe('AuthService login/session lifecycle', () => {
  it('creates a local administrator and issues a Control session', () => {
    const h = createHarness()
    seedAdmin(h)

    const control = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    expect(control.cookie).toContain('__Host-navin_control_session=')
    expect(control.principal.roles).toContain('ops.super_admin')
    expect(control.assuranceLevel).toBe('standard')
    expect(
      h.service.validate({ token: control.token, relyingParty: 'navin-control' }).relyingParty,
    ).toBe('navin-control')

    // An ops-only administrator has no mail role and cannot obtain a Mail session.
    expect(() =>
      h.service.login({
        email: 'admin@example.com',
        password: ADMIN_PASSWORD,
        relyingParty: 'navin-mail',
        surface: 'mail',
      }),
    ).toThrowError(/not permitted/)
  })

  it('issues a Mail session for a mail user', () => {
    const h = createHarness()
    seedMailUser(h)
    const mail = h.service.login({
      email: 'michael@example.com',
      password: MAIL_PASSWORD,
      relyingParty: 'navin-mail',
      surface: 'mail',
      mailboxId: 'mbx_michael',
    })
    expect(mail.cookie).toContain('__Host-navin_mail_session=')
    expect(mail.principal.roles).toEqual(['mail.user'])
    expect(mail.mailboxId).toBe('mbx_michael')
    expect(h.service.validate({ token: mail.token, relyingParty: 'navin-mail' }).relyingParty).toBe(
      'navin-mail',
    )
  })

  it('rejects bad credentials with a generic error and audits the failure', () => {
    const h = createHarness()
    seedAdmin(h)
    expect(() =>
      h.service.login({
        email: 'admin@example.com',
        password: 'wrong password value',
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    ).toThrowError(AuthError)
    try {
      h.service.login({
        email: 'nobody@example.com',
        password: 'whatever password',
        relyingParty: 'navin-control',
        surface: 'control',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError)
      expect((error as AuthError).code).toBe('INVALID_CREDENTIALS')
      expect((error as AuthError).message).toBe('Invalid credentials')
    }
    expect(h.events.some((event) => event.type === 'login.failed')).toBe(true)
  })

  it('prevents a mail-only user from obtaining a Control session', () => {
    const h = createHarness()
    seedMailUser(h)
    try {
      h.service.login({
        email: 'michael@example.com',
        password: MAIL_PASSWORD,
        relyingParty: 'navin-control',
        surface: 'control',
      })
      throw new Error('expected login to throw')
    } catch (error) {
      expect((error as AuthError).code).toBe('FORBIDDEN')
    }
  })

  it('keeps Mail and Control sessions in separate trust domains', () => {
    const h = createHarness()
    seedMailUser(h)
    const mail = h.service.login({
      email: 'michael@example.com',
      password: MAIL_PASSWORD,
      relyingParty: 'navin-mail',
      surface: 'mail',
    })
    try {
      h.service.validate({ token: mail.token, relyingParty: 'navin-control' })
      throw new Error('expected validate to throw')
    } catch (error) {
      expect((error as AuthError).code).toBe('WRONG_AUDIENCE')
    }
  })

  it('rotates session identifiers and revokes the previous token', () => {
    const h = createHarness()
    seedAdmin(h)
    const login = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    const rotated = h.service.rotate(login.sessionId)
    expect(rotated.sessionId).not.toBe(login.sessionId)
    expect(rotated.csrfToken).not.toBe(login.csrfToken)

    const old = h.store.getSession(login.sessionId) as SessionRecord
    expect(old.revokedAt).toBeTruthy()
    expect(old.rotatedTo).toBe(rotated.sessionId)

    expect(
      h.service.validate({ token: rotated.token, relyingParty: 'navin-control' }).sessionId,
    ).toBe(rotated.sessionId)
    try {
      h.service.validate({ token: login.token, relyingParty: 'navin-control' })
      throw new Error('expected old token to be revoked')
    } catch (error) {
      expect((error as AuthError).code).toBe('SESSION_REVOKED')
    }
  })

  it('revokes a single session and all sessions for a user', () => {
    const h = createHarness()
    const userId = seedAdmin(h)
    const a = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'cli',
    })
    const b = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    h.service.revoke(a.sessionId)
    expect(() =>
      h.service.validate({ token: a.token, relyingParty: 'navin-control' }),
    ).toThrowError(/revoked/)
    expect(h.service.revokeAllForUser(userId)).toBe(1)
    expect(() =>
      h.service.validate({ token: b.token, relyingParty: 'navin-control' }),
    ).toThrowError(/revoked/)
  })

  it('expires sessions when the clock passes the token TTL', () => {
    const h = createHarness()
    seedAdmin(h)
    const login = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    h.clock.advance(31 * 60 * 1000)
    try {
      h.service.validate({ token: login.token, relyingParty: 'navin-control' })
      throw new Error('expected validate to throw')
    } catch (error) {
      expect((error as AuthError).code).toBe('TOKEN_EXPIRED')
    }
  })
})

describe('Tier 3 recent authentication', () => {
  it('requires step-up before a tier 3 action and unlocks it afterwards', () => {
    const h = createHarness()
    seedAdmin(h)
    const login = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    const standard = h.store.getSession(login.sessionId) as SessionRecord
    expect(() =>
      h.service.assertTier3({
        session: standard,
        confirmation: 'restore backup-2026-10-01',
        expectedConfirmation: 'restore backup-2026-10-01',
      }),
    ).toThrowError(/Additional authentication is required/)

    h.clock.advance(2 * 60 * 1000)
    const steppedUp = h.service.stepUp({ sessionId: login.sessionId, password: ADMIN_PASSWORD })
    expect(steppedUp.assuranceLevel).toBe('step_up_recent')
    const record = h.store.getSession(steppedUp.sessionId) as SessionRecord
    expect(() =>
      h.service.assertTier3({
        session: record,
        confirmation: 'restore backup-2026-10-01',
        expectedConfirmation: 'restore backup-2026-10-01',
      }),
    ).not.toThrow()

    h.clock.advance(11 * 60 * 1000)
    const stale = h.store.getSession(steppedUp.sessionId) as SessionRecord
    expect(() =>
      h.service.assertTier3({
        session: stale,
        confirmation: 'restore backup-2026-10-01',
        expectedConfirmation: 'restore backup-2026-10-01',
      }),
    ).toThrowError(/Recent authentication is required/)
  })

  it('rotates the session during step-up and rejects a wrong password', () => {
    const h = createHarness()
    seedAdmin(h)
    const login = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    expect(() =>
      h.service.stepUp({ sessionId: login.sessionId, password: 'nope nope nope' }),
    ).toThrowError(/Invalid credentials/)
    const stepped = h.service.stepUp({ sessionId: login.sessionId, password: ADMIN_PASSWORD })
    expect(stepped.sessionId).not.toBe(login.sessionId)
  })
})

describe('password change and authorization', () => {
  it('rotates the verifier and revokes existing sessions on password change', () => {
    const h = createHarness()
    const userId = seedAdmin(h)
    const login = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    expect(() =>
      h.service.changePassword({
        userId,
        currentPassword: 'wrong',
        newPassword: 'a brand new admin passphrase',
      }),
    ).toThrowError(/Invalid credentials/)

    const revoked = h.service.changePassword({
      userId,
      currentPassword: ADMIN_PASSWORD,
      newPassword: 'a brand new admin passphrase',
    })
    expect(revoked).toBe(1)
    expect(() =>
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }),
    ).toThrowError(/revoked/)
    expect(() =>
      h.service.login({
        email: 'admin@example.com',
        password: ADMIN_PASSWORD,
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    ).toThrowError(/Invalid credentials/)
    expect(() =>
      h.service.login({
        email: 'admin@example.com',
        password: 'a brand new admin passphrase',
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    ).not.toThrow()
  })

  it('enforces scoped authorization and records denials', () => {
    const h = createHarness()
    seedMailUser(h)
    const mail = h.service.login({
      email: 'michael@example.com',
      password: MAIL_PASSWORD,
      relyingParty: 'navin-mail',
      surface: 'mail',
    })
    const session = h.store.getSession(mail.sessionId) as SessionRecord
    expect(h.service.authorize(session, { allOf: ['mail:read'] }).allowed).toBe(true)
    expect(() => h.service.assertAuthorized(session, { allOf: ['control:apply'] })).toThrowError(
      /lacks a required scope/,
    )
    expect(h.events.some((event) => event.type === 'authorization.denied')).toBe(true)
  })
})

describe('CSRF enforcement through the service', () => {
  it('accepts a same-origin state-changing request with the session token', () => {
    const h = createHarness()
    seedAdmin(h)
    const login = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    const session = h.store.getSession(login.sessionId) as SessionRecord
    expect(() =>
      h.service.checkCsrf({
        session,
        method: 'POST',
        csrfToken: login.csrfToken,
        origin: 'https://control.example.com',
      }),
    ).not.toThrow()
    expect(() =>
      h.service.checkCsrf({
        session,
        method: 'POST',
        csrfToken: login.csrfToken,
        origin: 'https://evil.example.com',
      }),
    ).toThrowError(/origin/i)
    expect(() =>
      h.service.checkCsrf({
        session,
        method: 'POST',
        csrfToken: 'forged',
        origin: 'https://control.example.com',
      }),
    ).toThrowError(/Cross-site request verification failed/)
    expect(h.events.some((event) => event.type === 'csrf.rejected')).toBe(true)
  })

  it('exposes the CSRF token for the session', () => {
    const h = createHarness()
    seedAdmin(h)
    const login = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    const session = h.store.getSession(login.sessionId) as SessionRecord
    expect(h.service.csrfTokenFor(session)).toBe(login.csrfToken)
    expect(login.csrfToken.length).toBeGreaterThan(0)
  })
})

describe('no secret leakage', () => {
  it('never records passwords or tokens in audit events or error messages', () => {
    const h = createHarness()
    seedAdmin(h)
    const login = h.service.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    try {
      h.service.login({
        email: 'admin@example.com',
        password: `${ADMIN_PASSWORD}-nope`,
        relyingParty: 'navin-control',
        surface: 'control',
      })
    } catch {
      // ignore
    }
    const serialized = JSON.stringify(h.events)
    expect(serialized).not.toContain(ADMIN_PASSWORD)
    expect(serialized).not.toContain(login.token)
    expect(serialized).not.toContain(login.csrfToken)
    for (const event of h.events) {
      expect(Object.keys(event)).not.toContain('password')
      expect(Object.keys(event)).not.toContain('token')
    }
  })
})
