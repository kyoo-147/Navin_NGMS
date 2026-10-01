import { FixedClock } from '../src/clock.js'
import { createControlIssuer, createMailIssuer, type TokenIssuer } from '../src/issuers.js'
import { DeterministicRandom } from '../src/random.js'
import { AuthService, type AuthAuditEvent } from '../src/service.js'
import { InMemoryAuthStore } from '../src/store/memory-store.js'
import type { AuthStore } from '../src/store/store.js'

export const MAIL_KEY = new Uint8Array(32).fill(0x11)
export const CONTROL_KEY = new Uint8Array(32).fill(0x22)
export const FIXED_START = '2026-10-01T10:00:00.000Z'

export interface Harness {
  clock: FixedClock
  random: DeterministicRandom
  store: AuthStore
  mailIssuer: TokenIssuer
  controlIssuer: TokenIssuer
  service: AuthService
  events: AuthAuditEvent[]
}

export function createHarness(
  overrides: {
    store?: AuthStore
    random?: DeterministicRandom
    passwordVerifier?: (password: string, encoded: string) => boolean
  } = {},
): Harness {
  const clock = new FixedClock(FIXED_START)
  const random = overrides.random ?? new DeterministicRandom('navin-auth-test-seed')
  const store = overrides.store ?? new InMemoryAuthStore()
  const mailIssuer = createMailIssuer({ key: MAIL_KEY, clock })
  const controlIssuer = createControlIssuer({ key: CONTROL_KEY, clock })
  const events: AuthAuditEvent[] = []
  const service = new AuthService({
    store,
    mailIssuer,
    controlIssuer,
    clock,
    random,
    audit: (event) => events.push(event),
    passwordVerifier: overrides.passwordVerifier,
    allowedOriginsByRelyingParty: {
      'navin-mail': ['https://mail.example.com'],
      'navin-control': ['https://control.example.com'],
    },
  })
  return { clock, random, store, mailIssuer, controlIssuer, service, events }
}

export const ADMIN_PASSWORD = 'correct horse battery staple'
export const MAIL_PASSWORD = 'mail user secret phrase'

export function seedAdmin(harness: Harness): string {
  const user = harness.service.createUser({
    email: 'admin@example.com',
    password: ADMIN_PASSWORD,
    roles: ['ops.super_admin'],
    userId: 'usr_admin1',
    accountId: 'acc_mainorg',
  })
  return user.userId
}

export function seedMailUser(harness: Harness): string {
  const user = harness.service.createUser({
    email: 'michael@example.com',
    password: MAIL_PASSWORD,
    roles: ['mail.user'],
    userId: 'usr_michael',
    accountId: 'acc_mainorg',
  })
  return user.userId
}
