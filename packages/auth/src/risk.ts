import { AuthError } from './errors.js'
import { assuranceRank, type AssuranceLevel } from './types.js'

export type RiskTier = 0 | 1 | 2 | 3

export const DEFAULT_RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000

export interface RiskPolicy {
  tier: RiskTier
  /** Immediate apply, no confirmation. */
  immediate: boolean
  /** Ordinary confirmation is required. */
  requiresConfirmation: boolean
  /** Explicit diff approval is required. */
  requiresDiffApproval: boolean
  /** Typed confirmation is required. */
  requiresTypedConfirmation: boolean
  /** Recent (step-up) authentication is required. */
  requiresRecentAuth: boolean
  /** Whether a non-interactive `--yes`/force flag may bypass the gate. */
  bypassableWithYes: boolean
}

const POLICIES: Record<RiskTier, RiskPolicy> = {
  0: {
    tier: 0,
    immediate: true,
    requiresConfirmation: false,
    requiresDiffApproval: false,
    requiresTypedConfirmation: false,
    requiresRecentAuth: false,
    bypassableWithYes: true,
  },
  1: {
    tier: 1,
    immediate: false,
    requiresConfirmation: true,
    requiresDiffApproval: false,
    requiresTypedConfirmation: false,
    requiresRecentAuth: false,
    bypassableWithYes: true,
  },
  2: {
    tier: 2,
    immediate: false,
    requiresConfirmation: true,
    requiresDiffApproval: true,
    requiresTypedConfirmation: false,
    requiresRecentAuth: false,
    bypassableWithYes: false,
  },
  3: {
    tier: 3,
    immediate: false,
    requiresConfirmation: true,
    requiresDiffApproval: true,
    requiresTypedConfirmation: true,
    requiresRecentAuth: true,
    bypassableWithYes: false,
  },
}

export function riskPolicy(tier: RiskTier): RiskPolicy {
  return POLICIES[tier]
}

/** Tier 3 (destructive restore, deletion, MX cutover) is never bypassed by `--yes`. */
export function canBypassWithYes(tier: RiskTier): boolean {
  return POLICIES[tier].bypassableWithYes
}

export function isRecentAuth(
  now: Date,
  lastAuthenticatedAt: string,
  windowMs: number = DEFAULT_RECENT_AUTH_WINDOW_MS,
): boolean {
  const last = new Date(lastAuthenticatedAt).getTime()
  if (!Number.isFinite(last)) {
    return false
  }
  const age = now.getTime() - last
  return age >= 0 && age <= windowMs
}

export interface SessionAssurance {
  assuranceLevel: AssuranceLevel
  lastAuthenticatedAt: string
}

/**
 * Tier 3 requires an MFA-or-stronger session AND authentication within the
 * recent-auth window. Step-up sets `step_up_recent` and refreshes
 * `lastAuthenticatedAt`, which satisfies both.
 */
export function assertTier3RecentAuth(
  session: SessionAssurance,
  now: Date,
  windowMs: number = DEFAULT_RECENT_AUTH_WINDOW_MS,
): void {
  if (assuranceRank(session.assuranceLevel) < assuranceRank('mfa_verified')) {
    throw new AuthError('STEP_UP_REQUIRED', { reason: 'assurance_too_low' })
  }
  if (!isRecentAuth(now, session.lastAuthenticatedAt, windowMs)) {
    throw new AuthError('RECENT_AUTH_REQUIRED', { reason: 'recent_auth_window_elapsed' })
  }
}

export function assertTypedConfirmation(provided: string | undefined, expected: string): void {
  if (!provided || provided !== expected) {
    throw new AuthError('TYPED_CONFIRMATION_REQUIRED', { reason: 'typed_confirmation_mismatch' })
  }
}

export interface Tier3Check {
  session: SessionAssurance
  confirmation?: string
  expectedConfirmation: string
  now: Date
  windowMs?: number
  force?: boolean
}

/**
 * Full Tier 3 gate. `force` is deliberately ignored: typed confirmation plus
 * recent auth can never be skipped by `--yes`.
 */
export function assertTier3(check: Tier3Check): void {
  assertTypedConfirmation(check.confirmation, check.expectedConfirmation)
  assertTier3RecentAuth(check.session, check.now, check.windowMs)
}
