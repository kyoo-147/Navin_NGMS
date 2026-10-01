import { describe, expect, it } from 'vitest'
import { InMemoryAuthStore } from '../src/store/memory-store.js'
import type { SessionRecord } from '../src/store/store.js'

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'ses_1',
    userId: 'usr_1',
    accountId: 'acc_1',
    email: 'user@example.com',
    roles: ['mail.user'],
    scopes: ['mail:read'],
    relyingParty: 'navin-mail',
    surface: 'mail',
    assuranceLevel: 'standard',
    issuedAt: '2026-10-01T10:00:00.000Z',
    lastAuthenticatedAt: '2026-10-01T10:00:00.000Z',
    expiresAt: '2026-10-01T22:00:00.000Z',
    tokenHash: 'hash',
    csrfSecret: 'secret',
    ...overrides,
  }
}

describe('InMemoryAuthStore', () => {
  it('stores and reads users, rejecting duplicate email', () => {
    const store = new InMemoryAuthStore()
    store.createUser({
      userId: 'usr_1',
      accountId: 'acc_1',
      email: 'User@Example.com',
      passwordHash: 'hash',
      roles: ['mail.user'],
      createdAt: '2026-10-01T10:00:00.000Z',
    })
    expect(store.getUserById('usr_1')?.email).toBe('user@example.com')
    expect(store.getUserById('usr_1')?.roles).toEqual(['mail.user'])
    expect(store.getUserByEmail('user@example.com')?.userId).toBe('usr_1')
    expect(store.getUserById('usr_missing')).toBeUndefined()
    expect(() =>
      store.createUser({
        userId: 'usr_2',
        accountId: 'acc_1',
        email: 'user@example.com',
        passwordHash: 'hash',
        roles: ['mail.user'],
        createdAt: '2026-10-01T10:00:00.000Z',
      }),
    ).toThrowError(/already exists/)
  })

  it('isolates returned records from later mutation', () => {
    const store = new InMemoryAuthStore()
    store.createSession(session())
    const first = store.getSession('ses_1')!
    first.scopes.push('mail:manage')
    first.revokedAt = 'mutated'
    const second = store.getSession('ses_1')!
    expect(second.scopes).toEqual(['mail:read'])
    expect(second.revokedAt).toBeUndefined()
  })

  it('revokes single and user-wide sessions', () => {
    const store = new InMemoryAuthStore()
    store.createSession(session({ sessionId: 'ses_1' }))
    store.createSession(session({ sessionId: 'ses_2' }))
    store.createSession(session({ sessionId: 'ses_3', userId: 'usr_2' }))
    store.revokeSession('ses_1', '2026-10-01T11:00:00.000Z')
    expect(store.getSession('ses_1')?.revokedAt).toBe('2026-10-01T11:00:00.000Z')
    expect(store.revokeUserSessions('usr_1', '2026-10-01T11:00:00.000Z')).toBe(1)
    expect(store.revokeUserSessions('usr_1', '2026-10-01T11:00:00.000Z')).toBe(0)
    expect(store.listUserSessions('usr_1')).toHaveLength(2)
  })

  it('throws when updating a missing session', () => {
    const store = new InMemoryAuthStore()
    expect(() => store.updateSession(session({ sessionId: 'ses_missing' }))).toThrowError(
      /Session not found/,
    )
  })
})
