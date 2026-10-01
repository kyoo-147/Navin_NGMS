import { describe, expect, it } from 'vitest'
import { AuthError } from '../src/errors.js'
import {
  assertTier3,
  assertTier3RecentAuth,
  assertTypedConfirmation,
  canBypassWithYes,
  DEFAULT_RECENT_AUTH_WINDOW_MS,
  isRecentAuth,
  riskPolicy,
} from '../src/risk.js'

const NOW = new Date('2026-10-01T10:00:00.000Z')

describe('Tier 3 risk and recent authentication', () => {
  it('encodes the four risk tiers', () => {
    expect(riskPolicy(0).immediate).toBe(true)
    expect(riskPolicy(1).requiresConfirmation).toBe(true)
    expect(riskPolicy(2).requiresDiffApproval).toBe(true)
    expect(riskPolicy(3).requiresTypedConfirmation).toBe(true)
    expect(riskPolicy(3).requiresRecentAuth).toBe(true)
  })

  it('never lets --yes bypass tier 2 or tier 3', () => {
    expect(canBypassWithYes(0)).toBe(true)
    expect(canBypassWithYes(1)).toBe(true)
    expect(canBypassWithYes(2)).toBe(false)
    expect(canBypassWithYes(3)).toBe(false)
  })

  it('computes the recent-auth window', () => {
    expect(isRecentAuth(NOW, new Date(NOW.getTime() - 1000).toISOString())).toBe(true)
    expect(
      isRecentAuth(NOW, new Date(NOW.getTime() - DEFAULT_RECENT_AUTH_WINDOW_MS - 1).toISOString()),
    ).toBe(false)
    expect(isRecentAuth(NOW, 'not-a-date')).toBe(false)
  })

  it('requires MFA-or-stronger assurance and recent auth for tier 3', () => {
    expect(() =>
      assertTier3RecentAuth(
        { assuranceLevel: 'standard', lastAuthenticatedAt: NOW.toISOString() },
        NOW,
      ),
    ).toThrowError(/Additional authentication is required/)

    expect(() =>
      assertTier3RecentAuth(
        {
          assuranceLevel: 'mfa_verified',
          lastAuthenticatedAt: new Date(
            NOW.getTime() - DEFAULT_RECENT_AUTH_WINDOW_MS - 1,
          ).toISOString(),
        },
        NOW,
      ),
    ).toThrowError(/Recent authentication is required/)

    expect(() =>
      assertTier3RecentAuth(
        { assuranceLevel: 'step_up_recent', lastAuthenticatedAt: NOW.toISOString() },
        NOW,
      ),
    ).not.toThrow()
  })

  it('requires an exact typed confirmation', () => {
    expect(() => assertTypedConfirmation('delete mbx_x', 'delete mbx_x')).not.toThrow()
    expect(() => assertTypedConfirmation('delete', 'delete mbx_x')).toThrowError(AuthError)
    expect(() => assertTypedConfirmation(undefined, 'delete mbx_x')).toThrowError(
      /Typed confirmation is required/,
    )
  })

  it('combines typed confirmation and recent auth, ignoring force', () => {
    const base = {
      session: {
        assuranceLevel: 'step_up_recent' as const,
        lastAuthenticatedAt: NOW.toISOString(),
      },
      expectedConfirmation: 'mx-cutover example.com',
      now: NOW,
      force: true,
    }
    expect(() => assertTier3({ ...base, confirmation: 'mx-cutover example.com' })).not.toThrow()
    expect(() => assertTier3({ ...base, confirmation: 'wrong' })).toThrowError(
      /Typed confirmation is required/,
    )
    expect(() =>
      assertTier3({
        ...base,
        confirmation: 'mx-cutover example.com',
        session: { assuranceLevel: 'standard', lastAuthenticatedAt: NOW.toISOString() },
      }),
    ).toThrowError(/Additional authentication is required/)
  })
})
