import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryAuthStore } from '../src/store/memory-store.js'
import { SqliteAuthStore } from '../src/store/sqlite-store.js'
import type { SessionRecord, TransactionPoint } from '../src/store/store.js'
import { ADMIN_PASSWORD, createHarness, seedAdmin } from './helpers.js'

class FaultyMemoryStore extends InMemoryAuthStore {
  failAt?: TransactionPoint
  protected override preCommit(point: TransactionPoint): void {
    if (this.failAt === point) {
      this.failAt = undefined
      throw new Error('injected fault')
    }
  }
}

class FaultySqliteStore extends SqliteAuthStore {
  failAt?: TransactionPoint
  protected override preCommit(point: TransactionPoint): void {
    if (this.failAt === point) {
      this.failAt = undefined
      throw new Error('injected fault')
    }
  }
}

function controlLogin(service: ReturnType<typeof createHarness>['service']) {
  return service.login({
    email: 'admin@example.com',
    password: ADMIN_PASSWORD,
    relyingParty: 'navin-control',
    surface: 'control',
  })
}

describe('atomic rotation and password change (in-memory)', () => {
  it('rolls back rotation on failure, leaving exactly one live session', () => {
    const store = new FaultyMemoryStore()
    const h = createHarness({ store })
    seedAdmin(h)
    const login = controlLogin(h.service)

    store.failAt = 'rotate_session'
    expect(() => h.service.rotate(login.sessionId)).toThrowError(/injected fault/)

    expect(h.store.getSession(login.sessionId)?.revokedAt).toBeUndefined()
    expect(h.store.listUserSessions('usr_admin1')).toHaveLength(1)
    expect(
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }).sessionId,
    ).toBe(login.sessionId)

    const rotated = h.service.rotate(login.sessionId)
    expect(h.store.getSession(login.sessionId)?.revokedAt).toBeTruthy()
    expect(h.store.listUserSessions('usr_admin1')).toHaveLength(2)
    expect(
      h.service.validate({ token: rotated.token, relyingParty: 'navin-control' }).sessionId,
    ).toBe(rotated.sessionId)
  })

  it('rolls back a failed password change, keeping the old verifier and sessions', () => {
    const store = new FaultyMemoryStore()
    const h = createHarness({ store })
    const userId = seedAdmin(h)
    const login = controlLogin(h.service)

    store.failAt = 'change_password'
    expect(() =>
      h.service.changePassword({
        userId,
        currentPassword: ADMIN_PASSWORD,
        newPassword: 'a brand new passphrase value',
      }),
    ).toThrowError(/injected fault/)

    expect(
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }).sessionId,
    ).toBe(login.sessionId)
    expect(() =>
      h.service.login({
        email: 'admin@example.com',
        password: ADMIN_PASSWORD,
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    ).not.toThrow()
    expect(() =>
      h.service.login({
        email: 'admin@example.com',
        password: 'a brand new passphrase value',
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    ).toThrowError(/Invalid credentials/)
  })
})

describe('atomic rotation and password change (real SQLite)', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'navin-auth-atomic-'))
    dbPath = join(dir, 'auth.db')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rolls back rotation on failure and commits it on success', () => {
    const store = new FaultySqliteStore(dbPath)
    const h = createHarness({ store })
    seedAdmin(h)
    const login = controlLogin(h.service)

    store.failAt = 'rotate_session'
    expect(() => h.service.rotate(login.sessionId)).toThrowError(/injected fault/)

    expect(h.store.getSession(login.sessionId)?.revokedAt).toBeUndefined()
    expect(h.store.listUserSessions('usr_admin1')).toHaveLength(1)

    const rotated = h.service.rotate(login.sessionId)
    expect(h.store.getSession(login.sessionId)?.revokedAt).toBeTruthy()
    expect(h.store.getSession(login.sessionId)?.rotatedTo).toBe(rotated.sessionId)
    expect(h.store.getSession(rotated.sessionId)?.sessionId).toBe(rotated.sessionId)
    expect(
      h.service.validate({ token: rotated.token, relyingParty: 'navin-control' }).sessionId,
    ).toBe(rotated.sessionId)
    h.service.close()
  })

  it('rolls back a failed password change and commits it on success', () => {
    const store = new FaultySqliteStore(dbPath)
    const h = createHarness({ store })
    const userId = seedAdmin(h)
    const login = controlLogin(h.service)

    store.failAt = 'change_password'
    expect(() =>
      h.service.changePassword({
        userId,
        currentPassword: ADMIN_PASSWORD,
        newPassword: 'a brand new passphrase value',
      }),
    ).toThrowError(/injected fault/)

    expect(
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }).sessionId,
    ).toBe(login.sessionId)
    expect(() =>
      h.service.login({
        email: 'admin@example.com',
        password: ADMIN_PASSWORD,
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    ).not.toThrow()

    const revoked = h.service.changePassword({
      userId,
      currentPassword: ADMIN_PASSWORD,
      newPassword: 'a brand new passphrase value',
    })
    expect(revoked).toBeGreaterThanOrEqual(1)
    expect(() =>
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }),
    ).toThrowError(/revoked/)
    expect(() =>
      h.service.login({
        email: 'admin@example.com',
        password: 'a brand new passphrase value',
        relyingParty: 'navin-control',
        surface: 'control',
      }),
    ).not.toThrow()
    h.service.close()
  })

  it('rolls back a rotation whose insert conflicts inside the transaction', () => {
    const store = new SqliteAuthStore(dbPath)
    const h = createHarness({ store })
    seedAdmin(h)
    const login = controlLogin(h.service)

    // Pre-insert a session occupying the identifier the new session will reuse,
    // forcing the INSERT inside rotateSession to fail.
    const collision: SessionRecord = {
      sessionId: 'ses_collision',
      userId: 'usr_admin1',
      accountId: 'acc_mainorg',
      email: 'admin@example.com',
      roles: ['ops.super_admin'],
      scopes: ['control:plan'],
      relyingParty: 'navin-control',
      surface: 'control',
      assuranceLevel: 'standard',
      issuedAt: h.clock.now().toISOString(),
      lastAuthenticatedAt: h.clock.now().toISOString(),
      expiresAt: new Date(h.clock.now().getTime() + 60000).toISOString(),
      tokenHash: 'collision-hash',
      csrfSecret: 'AAAAAAAAAAAAAAAAAAAAAA',
    }
    h.store.createSession(collision)

    const replacement: SessionRecord = { ...collision, sessionId: 'ses_collision' }
    expect(() =>
      store.rotateSession(login.sessionId, replacement, h.clock.now().toISOString()),
    ).toThrow()

    // The failed transaction left the original session live and untouched.
    expect(h.store.getSession(login.sessionId)?.revokedAt).toBeUndefined()
    expect(h.store.getSession('ses_collision')?.tokenHash).toBe('collision-hash')
    expect(
      h.service.validate({ token: login.token, relyingParty: 'navin-control' }).sessionId,
    ).toBe(login.sessionId)
    h.service.close()
  })

  it('survives a restart after rotation with only the new session live', () => {
    const first = new SqliteAuthStore(dbPath)
    const h1 = createHarness({ store: first })
    seedAdmin(h1)
    const login = controlLogin(h1.service)
    const rotated = h1.service.rotate(login.sessionId)
    h1.service.close()

    const second = new SqliteAuthStore(dbPath)
    const h2 = createHarness({ store: second })
    expect(
      h2.service.validate({ token: rotated.token, relyingParty: 'navin-control' }).sessionId,
    ).toBe(rotated.sessionId)
    expect(() =>
      h2.service.validate({ token: login.token, relyingParty: 'navin-control' }),
    ).toThrowError(/revoked/)
    h2.service.close()
  })
})
