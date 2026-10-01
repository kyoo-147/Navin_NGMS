import type {
  MailMutationRequest,
  MailMutationResponse,
  MailQueryRequest,
  MailQueryResponse,
  MailSubmissionRequest,
  MailSubmissionResponse,
} from '@navin/contracts'
import {
  GatewayError,
  MailGateway,
  SqliteIdempotencyStore,
  type MailGatewayContext,
  type NormalizedEmail,
  type NormalizedMailbox,
  type NormalizedSession,
  type NormalizedThread,
} from '@navin/mail-gateway'
import type { Clock } from '../ports/clock.js'
import {
  MailAccountCredentialProvider,
  type MailAccountBinding,
  type SessionLookup,
} from './credentials.js'
import { MailEventBus } from './events.js'

export interface MailSenderBinding {
  /** Authorized sender identity id (prefixed `usr_` or `als_`). */
  readonly identityId: string
  /** Server-authoritative From address for this mailbox. */
  readonly address: string
}

export interface MailServiceOptions {
  databasePath: string
  clock: Clock
  /** `null` disables the Mail BFF; every Mail endpoint then fails closed. */
  account: MailAccountBinding | null
  /** `null` leaves Mail read-only: compose/send is disabled. */
  sender: MailSenderBinding | null
  sessions: SessionLookup
}

/**
 * The Navin Mail BFF.
 *
 * Wraps the normalized JMAP gateway with server-side credentials, a durable
 * idempotency store and a truthful event stream. When no upstream binding is
 * configured the service reports `configured === false` and refuses every
 * operation rather than degrading to an unauthenticated or fake backend.
 */
export class MailService {
  readonly configured: boolean
  readonly events: MailEventBus
  /** Server-authoritative compose/send binding, or `null` when read-only. */
  readonly sender: MailSenderBinding | null

  private readonly gateway: MailGateway | null
  private readonly idempotency: SqliteIdempotencyStore | null

  constructor(options: MailServiceOptions) {
    this.events = new MailEventBus(options.clock)
    this.sender = options.account ? options.sender : null
    if (!options.account) {
      this.configured = false
      this.gateway = null
      this.idempotency = null
      return
    }
    this.configured = true
    this.idempotency = new SqliteIdempotencyStore({
      filename: mailIdempotencyPath(options.databasePath),
    })
    this.gateway = new MailGateway({
      credentials: new MailAccountCredentialProvider(options.sessions, options.account),
      idempotency: this.idempotency,
    })
  }

  close(): void {
    this.idempotency?.close()
  }

  getSession(ctx: MailGatewayContext): Promise<NormalizedSession> {
    return this.requireGateway().getSession(ctx)
  }

  listMailboxes(ctx: MailGatewayContext, accountId: string): Promise<NormalizedMailbox[]> {
    return this.requireGateway().listMailboxes(ctx, accountId)
  }

  getEmail(
    ctx: MailGatewayContext,
    accountId: string,
    messageId: string,
  ): Promise<NormalizedEmail> {
    return this.requireGateway().getEmail(ctx, accountId, messageId)
  }

  getThread(
    ctx: MailGatewayContext,
    accountId: string,
    threadId: string,
  ): Promise<NormalizedThread> {
    return this.requireGateway().getThread(ctx, accountId, threadId)
  }

  query(ctx: MailGatewayContext, request: MailQueryRequest): Promise<MailQueryResponse> {
    return this.requireGateway().queryMail(ctx, request)
  }

  async mutate(
    ctx: MailGatewayContext,
    request: MailMutationRequest,
  ): Promise<MailMutationResponse> {
    const response = await this.requireGateway().mutate(ctx, request)
    this.events.publish('mail.mutation.applied', {
      accountId: request.accountId,
      mutation: request.mutation,
      affectedCount: response.affectedCount,
      newState: response.newState,
    })
    return response
  }

  async submit(
    ctx: MailGatewayContext,
    request: MailSubmissionRequest,
  ): Promise<MailSubmissionResponse> {
    this.assertAuthorizedSender(request)
    const response = await this.requireGateway().submit(ctx, request)
    this.events.publish('mail.submission.accepted', {
      accountId: request.accountId,
      submissionId: response.submissionId,
      status: response.status,
    })
    return response
  }

  /**
   * The sender identity and From address are server-authoritative. A request
   * may not select a different identity or send as a different address, and a
   * mismatch is rejected before any upstream call — never silently rewritten.
   * Only the address is authoritative; a display name may vary.
   */
  private assertAuthorizedSender(request: MailSubmissionRequest): void {
    const sender = this.sender
    if (!sender) {
      throw new GatewayError({
        code: 'FORBIDDEN',
        message: 'No server-configured sender identity is available for submission',
        retryable: false,
        details: { reason: 'sender_not_configured' },
      })
    }
    if (request.senderIdentityId !== sender.identityId) {
      throw new GatewayError({
        code: 'FORBIDDEN',
        message: 'Sender identity does not match the server-configured identity',
        retryable: false,
        details: { reason: 'sender_identity_mismatch' },
      })
    }
    if (request.from.address.trim().toLowerCase() !== sender.address.trim().toLowerCase()) {
      throw new GatewayError({
        code: 'FORBIDDEN',
        message: 'From address does not match the server-configured sender address',
        retryable: false,
        details: { reason: 'sender_address_mismatch' },
      })
    }
  }

  private requireGateway(): MailGateway {
    if (!this.gateway) {
      throw new GatewayError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Mail is not configured on this Navin deployment',
        retryable: false,
      })
    }
    return this.gateway
  }
}

function mailIdempotencyPath(databasePath: string): string {
  return databasePath === ':memory:' ? ':memory:' : `${databasePath}.mail-gateway.db`
}
