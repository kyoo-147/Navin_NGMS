import {
  MailMutationRequestSchema,
  MailMutationResponseSchema,
  MailQueryRequestSchema,
  MailQueryResponseSchema,
  MailSubmissionRequestSchema,
  MailSubmissionResponseSchema,
  type FolderMailMutationRequest,
  type LabelMailMutationRequest,
  type MailMutationResponse,
  type MailQueryRequest,
  type MailQueryResponse,
  type MailSubmissionRequest,
  type MailSubmissionResponse,
  type StandardMailMutationRequest,
} from '@navin/contracts'
import { BaseApiClient, type RequestOptions } from './base-client.js'
import { withIdempotencyKey } from './ids.js'
import {
  MailAuthSessionSchema,
  MailLoginRequestSchema,
  MailLoginResponseSchema,
  MailLogoutResponseSchema,
  MailMailboxListSchema,
  MailMessageSchema,
  MailSessionInfoSchema,
  MailThreadSchema,
  type MailAuthSession,
  type MailLoginRequest,
  type MailLoginResponse,
  type MailLogoutResponse,
  type MailMailbox,
  type MailMessage,
  type MailSessionInfo,
  type MailThread,
} from './mail-schemas.js'
import type { ApiClientOptions } from './options.js'
import { routes } from './routes.js'
import { NavinEventSchema } from './schemas.js'
import type { SseRequestOptions, SseSubscription } from './sse.js'

type WithOptionalIdempotencyKey<T extends { idempotencyKey: unknown }> = Omit<
  T,
  'idempotencyKey'
> & { idempotencyKey?: string }

export type MailMutationInput =
  | WithOptionalIdempotencyKey<StandardMailMutationRequest>
  | WithOptionalIdempotencyKey<FolderMailMutationRequest>
  | WithOptionalIdempotencyKey<LabelMailMutationRequest>

export type MailSubmissionInput = WithOptionalIdempotencyKey<MailSubmissionRequest>

export type MailApiClientOptions = Omit<ApiClientOptions, 'surface'>

export type MailEventOptions = Omit<SseRequestOptions<typeof NavinEventSchema>, 'path' | 'schema'>

/**
 * Mail-surface client. Authenticates with the Mail relying party (host-only cookie/BFF session,
 * or a bearer token for non-browser clients) and never carries Control credentials.
 */
export class MailApiClient extends BaseApiClient {
  constructor(options: MailApiClientOptions) {
    super({ ...options, surface: 'mail' })
  }

  login(input: MailLoginRequest, options?: RequestOptions): Promise<MailLoginResponse> {
    return this.send({
      method: 'POST',
      path: routes.mail.auth.login,
      body: input,
      requestSchema: MailLoginRequestSchema,
      responseSchema: MailLoginResponseSchema,
      ...options,
    })
  }

  session(options?: RequestOptions): Promise<MailAuthSession> {
    return this.send({
      method: 'GET',
      path: routes.mail.auth.session,
      responseSchema: MailAuthSessionSchema,
      ...options,
    })
  }

  logout(options?: RequestOptions): Promise<MailLogoutResponse> {
    return this.send({
      method: 'POST',
      path: routes.mail.auth.logout,
      responseSchema: MailLogoutResponseSchema,
      ...options,
    })
  }

  /** The normalized upstream engine session: accounts and advertised capabilities. */
  engineSession(options?: RequestOptions): Promise<MailSessionInfo> {
    return this.send({
      method: 'GET',
      path: routes.mail.session,
      responseSchema: MailSessionInfoSchema,
      ...options,
    })
  }

  async listMailboxes(accountId: string, options?: RequestOptions): Promise<MailMailbox[]> {
    const result = await this.send({
      method: 'GET',
      path: routes.mail.mailboxes,
      query: { accountId },
      responseSchema: MailMailboxListSchema,
      ...options,
    })
    return result.mailboxes
  }

  getMessage(accountId: string, messageId: string, options?: RequestOptions): Promise<MailMessage> {
    return this.send({
      method: 'GET',
      path: routes.mail.message(messageId),
      query: { accountId },
      responseSchema: MailMessageSchema,
      ...options,
    })
  }

  getThread(accountId: string, threadId: string, options?: RequestOptions): Promise<MailThread> {
    return this.send({
      method: 'GET',
      path: routes.mail.thread(threadId),
      query: { accountId },
      responseSchema: MailThreadSchema,
      ...options,
    })
  }

  query(request: MailQueryRequest, options?: RequestOptions): Promise<MailQueryResponse> {
    return this.send({
      method: 'POST',
      path: routes.mail.query,
      body: request,
      requestSchema: MailQueryRequestSchema,
      responseSchema: MailQueryResponseSchema,
      ...options,
    })
  }

  mutate(request: MailMutationInput, options?: RequestOptions): Promise<MailMutationResponse> {
    const payload = withIdempotencyKey(request, this.options.idempotencyKeyFactory)
    return this.send({
      method: 'POST',
      path: routes.mail.mutations,
      body: payload,
      requestSchema: MailMutationRequestSchema,
      responseSchema: MailMutationResponseSchema,
      idempotencyKey: payload.idempotencyKey,
      ...options,
    })
  }

  submit(request: MailSubmissionInput, options?: RequestOptions): Promise<MailSubmissionResponse> {
    const payload = withIdempotencyKey(request, this.options.idempotencyKeyFactory)
    return this.send({
      method: 'POST',
      path: routes.mail.submissions,
      body: payload,
      requestSchema: MailSubmissionRequestSchema,
      responseSchema: MailSubmissionResponseSchema,
      idempotencyKey: payload.idempotencyKey,
      ...options,
    })
  }

  events(options: MailEventOptions): SseSubscription {
    return this.stream({ path: routes.mail.events, schema: NavinEventSchema, ...options })
  }
}
