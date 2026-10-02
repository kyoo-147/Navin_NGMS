import { sha256Digest } from '@navin/action-core'
import { normalizeDomainName } from '@navin/engine-core'

import { OrganizationError, toOrganizationError } from './errors.js'

export interface DomainProvisioningInput {
  name: string
  description?: string
  dkimSigning?: boolean
}

export interface ValidatedDomainRequest {
  name: string
  description?: string
  dkimSigning?: boolean
}

/**
 * Validates and normalizes a domain create request.
 *
 * Domain syntax is delegated to the engine adapter's normalizer so the control
 * plane and the engine agree on what a valid domain is; an invalid name can
 * never reach the engine boundary.
 */
export function validateDomainRequest(input: DomainProvisioningInput): ValidatedDomainRequest {
  let name: string
  try {
    name = normalizeDomainName(input.name)
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
      'Domain description must be at most 256 characters',
      { details: { name } },
    )
  }
  if (input.dkimSigning !== undefined && typeof input.dkimSigning !== 'boolean') {
    throw new OrganizationError('VALIDATION_FAILED', 'Domain dkimSigning must be a boolean', {
      details: { name },
    })
  }

  return {
    name,
    ...(description === undefined || description.length === 0 ? {} : { description }),
    ...(input.dkimSigning === undefined ? {} : { dkimSigning: input.dkimSigning }),
  }
}

/** Stable, restart-surviving idempotency key derived from the requested change. */
export function derivedDomainIdempotencyKey(request: ValidatedDomainRequest): string {
  const digest = sha256Digest({ name: request.name })
  return `org-domain-${digest.slice('sha256:'.length, 'sha256:'.length + 40)}`
}
