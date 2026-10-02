import { randomUUID } from 'node:crypto'
import { sha256Digest } from '@navin/action-core'
import { parseEmailAddress } from '@navin/engine-core'

import { OrganizationError, toOrganizationError } from './errors.js'

export interface MailboxProvisioningInput {
  email: string
  description?: string
  /**
   * Apply-time secret. It is never part of the action parameters, idempotency
   * payload, engine plan, job, evidence or logs; it is only fed to the engine
   * through `EngineApplyOptions.secrets` while the create is applied. It is not
   * trimmed: the caller's bytes are what the mailbox is created with.
   */
  password?: string
}

/** Validated mailbox request *without* the password (which is apply-only). */
export interface ValidatedMailboxRequest {
  email: string
  description?: string
}

export const MIN_MAILBOX_PASSWORD_LENGTH = 12
export const MAX_MAILBOX_PASSWORD_LENGTH = 256

/**
 * Validates and normalizes a mailbox create request.
 *
 * The address syntax is delegated to the engine adapter's address parser so the
 * control plane and the engine agree on what a valid mailbox is; an invalid
 * address can never reach the engine boundary. The password is deliberately
 * excluded from the returned, persistable request.
 */
export function validateMailboxRequest(input: MailboxProvisioningInput): ValidatedMailboxRequest {
  let email: string
  try {
    email = parseEmailAddress(input.email).address
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
      'Mailbox description must be at most 256 characters',
      { details: { email } },
    )
  }

  return {
    email,
    ...(description === undefined || description.length === 0 ? {} : { description }),
  }
}

/**
 * Validates the length of an apply-time mailbox password.
 *
 * The value is neither trimmed nor echoed: a failure reports only the accepted
 * bounds, so a secret can never appear in an error envelope, log line or
 * evidence record. The validated bytes are returned unchanged.
 */
export function validateMailboxPassword(password: string): string {
  if (
    typeof password !== 'string' ||
    password.length < MIN_MAILBOX_PASSWORD_LENGTH ||
    password.length > MAX_MAILBOX_PASSWORD_LENGTH
  ) {
    throw new OrganizationError(
      'VALIDATION_FAILED',
      `Mailbox password must be between ${MIN_MAILBOX_PASSWORD_LENGTH} and ${MAX_MAILBOX_PASSWORD_LENGTH} characters`,
    )
  }
  return password
}

/** Stable, restart-surviving idempotency key derived from the requested change. */
export function derivedMailboxIdempotencyKey(request: ValidatedMailboxRequest): string {
  const digest = sha256Digest({
    email: request.email,
    ...(request.description === undefined ? {} : { description: request.description }),
  })
  return `org-mailbox-${digest.slice('sha256:'.length, 'sha256:'.length + 40)}`
}

/** Owner token returned by an exclusive secret claim; required to release it. */
export interface MailboxSecretClaim {
  readonly actionId: string
  readonly token: string
}

interface MailboxSecretEntry {
  token: string
  /** `undefined` is a valid owner state: the claimant supplied no secret. */
  password: string | undefined
}

/**
 * Request-scoped, in-memory broker for apply-time mailbox passwords with
 * exclusive ownership.
 *
 * A password only ever lives here, keyed by the action it belongs to, for the
 * duration of the request that applies that action. It is never serialized, and
 * a job that needs it after a process loss fails closed (needs_attention /
 * secret required) instead of mutating the engine without it.
 *
 * A claim is exclusive: a second concurrent claimant for the same action fails
 * closed *before* job execution rather than overwriting the first, and a release
 * only removes the entry it owns (checked by token). This prevents one request
 * from applying, reading or clearing another request's password.
 */
export class MailboxSecretBroker {
  private readonly entries = new Map<string, MailboxSecretEntry>()

  /**
   * Claims exclusive ownership of an action's apply slot. `password` may be
   * `undefined` to claim without a secret (a secretless owner); the claim still
   * blocks any concurrent claimant for the same action, so a request without a
   * password can never run a job that another request is authorizing.
   */
  claim(actionId: string, password: string | undefined): MailboxSecretClaim {
    if (this.entries.has(actionId)) {
      throw new OrganizationError(
        'CONFLICT',
        'Another apply for this action is already in progress in this process',
        { details: { needsAttention: true } },
      )
    }
    const token = randomUUID()
    this.entries.set(actionId, { token, password })
    return { actionId, token }
  }

  get(actionId: string): string | undefined {
    return this.entries.get(actionId)?.password
  }

  release(claim: MailboxSecretClaim): void {
    const entry = this.entries.get(claim.actionId)
    if (entry !== undefined && entry.token === claim.token) {
      this.entries.delete(claim.actionId)
    }
  }

  get size(): number {
    return this.entries.size
  }
}
