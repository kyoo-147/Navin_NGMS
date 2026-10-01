import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FixedClock } from '../src/clock.js'
import { createControlIssuer, createMailIssuer } from '../src/issuers.js'
import { SystemRandom } from '../src/random.js'
import { AuthService } from '../src/service.js'
import { SqliteAuthStore } from '../src/store/sqlite-store.js'
import { ADMIN_PASSWORD, CONTROL_KEY, FIXED_START, MAIL_KEY } from './helpers.js'

/**
 * Real SQLite restart tests. Each "process restart" opens a brand new
 * DatabaseSync against the same file, with fresh issuer objects, and proves
 * users, passwords, live sessions, rotation and revocation survive.
 */
describe('SqliteAuthStore restart behavior', () => {
  let dir: string
  let dbPath: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'navin-auth-'))
    dbPath = join(dir, 'auth.db')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function startService(): AuthService {
    const clock = new FixedClock(FIXED_START)
    return new AuthService({
      store: new SqliteAuthStore(dbPath),
      mailIssuer: createMailIssuer({ key: MAIL_KEY, clock }),
      controlIssuer: createControlIssuer({ key: CONTROL_KEY, clock }),
      clock,
      random: new SystemRandom(),
      allowedOriginsByRelyingParty: { 'navin-control': ['https://control.example.com'] },
    })
  }

  it('persists a user, password and live session across a restart', () => {
    const first = startService()
    first.createUser({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      roles: ['ops.super_admin'],
      userId: 'usr_admin1',
      accountId: 'acc_mainorg',
    })
    const login = first.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    first.close()

    const second = startService()
    const relogin = second.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    expect(relogin.principal.userId).toBe('usr_admin1')
    expect(relogin.principal.roles).toContain('ops.super_admin')

    const validated = second.validate({ token: login.token, relyingParty: 'navin-control' })
    expect(validated.userId).toBe('usr_admin1')
    expect(validated.sessionId).toBe(login.sessionId)
    second.close()
  })

  it('persists revocation across a restart', () => {
    const first = startService()
    const login = first.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'cli',
    })
    first.revoke(login.sessionId)
    first.close()

    const second = startService()
    expect(() =>
      second.validate({ token: login.token, relyingParty: 'navin-control' }),
    ).toThrowError(/revoked/)
    second.close()
  })

  it('persists rotation across a restart and keeps the old token revoked', () => {
    const first = startService()
    const login = first.login({
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
      relyingParty: 'navin-control',
      surface: 'control',
    })
    const rotated = first.rotate(login.sessionId)
    first.close()

    const second = startService()
    expect(second.validate({ token: rotated.token, relyingParty: 'navin-control' }).sessionId).toBe(
      rotated.sessionId,
    )
    expect(() =>
      second.validate({ token: login.token, relyingParty: 'navin-control' }),
    ).toThrowError(/revoked/)
    expect(second.listSessionsForUser('usr_admin1').length).toBeGreaterThanOrEqual(2)
    second.close()
  })
})
