import type { ConfirmationType, RiskTier } from '@navin/contracts'

import { ActionCoreError } from '../errors.js'

/**
 * Maps a risk tier to the minimum confirmation a surface must collect.
 * Tier 3 is typed confirmation + recent authentication and is never bypassable.
 */
export function confirmationTypeForRisk(tier: RiskTier): ConfirmationType {
  switch (tier) {
    case 0:
      return 'none'
    case 1:
      return 'simple'
    case 2:
      return 'explicit_diff'
    case 3:
      return 'typed_confirmation'
  }
}

export function requiresRecentAuthForRisk(tier: RiskTier): boolean {
  return tier === 3
}

export function requiresApprovalForRisk(tier: RiskTier): boolean {
  return tier >= 2
}

/**
 * Phrase an operator must type to approve a Tier 3 action. Binding the phrase to
 * the action id prevents a confirmation for one action being reused for another.
 */
export function expectedTier3Phrase(action: { name: string; id: string }): string {
  return `APPROVE ${action.name} ${action.id}`
}

export function assertConfirmationMatchesRisk(
  tier: RiskTier,
  confirmationType: ConfirmationType,
): void {
  const expected = confirmationTypeForRisk(tier)
  const acceptable: Record<RiskTier, readonly ConfirmationType[]> = {
    0: ['none'],
    1: ['simple', 'explicit_diff'],
    2: ['explicit_diff'],
    3: ['typed_confirmation'],
  }
  if (!acceptable[tier].includes(confirmationType)) {
    throw new ActionCoreError(
      'VALIDATION_FAILED',
      `Confirmation type ${confirmationType} is insufficient for risk tier ${tier}`,
      { details: { tier, confirmationType, expected } },
    )
  }
}

export function assertTypedPhraseMatches(
  action: { name: string; id: string },
  phrase: string,
): void {
  const expected = expectedTier3Phrase(action)
  if (phrase !== expected) {
    throw new ActionCoreError(
      'APPROVAL_REQUIRED',
      'Tier 3 typed confirmation phrase did not match',
      {
        details: { expected, provided: phrase },
      },
    )
  }
}
