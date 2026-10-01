import { sha256Digest } from '@navin/action-core'
import { parseEmailAddress } from '@navin/engine-core'

import { OrganizationError, toOrganizationError } from './errors.js'

export interface AliasProvisioningInput {
  address: string
  target: string
  description?: string
}

export interface ValidatedAliasRequest {
  address: string
  target: string
  description?: string
}

export const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9._-]+$/
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128

/**
 * Validates and normalizes the alias address and destination.
 *
 * Domain and address syntax is delegated to the engine adapter's address parser
 * so the control plane and the engine agree on what a valid address is; an
 * invalid address can never reach the engine boundary.
 */
export function validateAliasRequest(input: AliasProvisioningInput): ValidatedAliasRequest {
  let address: string
  let target: string
  try {
    address = parseEmailAddress(input.address).address
    target = parseEmailAddress(input.target).address
  } catch (error) {
    const normalized = toOrganizationError(error, { code: 'VALIDATION_FAILED' })
    throw new OrganizationError('VALIDATION_FAILED', normalized.message, {
      details: normalized.details,
      cause: error,
    })
  }

  const description = input.description?.trim()
  if (description !== undefined && description.length > 256) {
    throw new OrganizationError(
      'VALIDATION_FAILED',
      'Alias description must be at most 256 characters',
      {
        details: { address },
      },
    )
  }

  return {
    address,
    target,
    ...(description === undefined || description.length === 0 ? {} : { description }),
  }
}

/**
 * Validates an explicit idempotency key. Empty or whitespace-only keys are
 * rejected explicitly (they must never silently fall back to the derived key),
 * and the key must be bounded and restricted to safe characters.
 */
export function validateIdempotencyKey(key: string): string {
  if (key.length === 0 || key.trim().length === 0) {
    throw new OrganizationError('VALIDATION_FAILED', 'Idempotency key must not be empty', {
      details: { key },
    })
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new OrganizationError(
      'VALIDATION_FAILED',
      `Idempotency key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      { details: { key, length: key.length } },
    )
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new OrganizationError(
      'VALIDATION_FAILED',
      'Idempotency key may only contain letters, digits, dot, underscore and hyphen',
      { details: { key } },
    )
  }
  return key
}

/** Stable, restart-surviving idempotency key derived from the requested change. */
export function derivedAliasIdempotencyKey(request: ValidatedAliasRequest): string {
  const digest = sha256Digest({ address: request.address, target: request.target })
  return `org-alias-${digest.slice('sha256:'.length, 'sha256:'.length + 40)}`
}
