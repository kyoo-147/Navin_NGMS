import { randomUUID } from 'node:crypto'
import type {
  MailMutationRequest,
  MailMutationResponse,
  MailQueryRequest,
  MailQueryResponse,
  MailSubmissionRequest,
  MailSubmissionResponse,
  MessageId,
} from '@navin/contracts'
import { GatewayError, gatewayErrorFromJmapMethod } from './errors.js'
import type { CredentialProvider } from './credentials/provider.js'
import { JmapClient, type JmapInvokeOptions } from './jmap/client.js'
import type { JmapTransport } from './jmap/transport.js'
import {
  JMAP_MAIL,
  JMAP_SUBMISSION,
  SCHEDULED_SEND_CAPABILITY,
  requireCapability,
} from './jmap/capabilities.js'
import type {
  JmapChanges,
  JmapEmail,
  JmapEmailSubmission,
  JmapGetResult,
  JmapIdentity,
  JmapMailbox,
  JmapQueryResult,
  JmapSetResult,
  JmapThread,
} from './jmap/types.js'
import { fingerprint, runIdempotent, type IdempotencyStore } from './idempotency/store.js'
import { encodeId, upstreamId } from './mapping/id.js'
import { toNormalizedSession, type NormalizedSession } from './mapping/session.js'
import { toNormalizedAccount, type NormalizedAccount } from './mapping/account.js'
import {
  findMailboxByRole,
  toNormalizedMailbox,
  type NormalizedMailbox,
} from './mapping/mailbox.js'
import { EMAIL_GET_PROPERTIES, toNormalizedEmail, type NormalizedEmail } from './mapping/email.js'
import { toNormalizedThread, type NormalizedThread } from './mapping/thread.js'
import { toNormalizedChanges, type NormalizedChanges } from './mapping/changes.js'
import { buildEmailQueryFilter, buildEmailQuerySort, toMailQueryResponse } from './mapping/query.js'
import { planEmailSetMutation } from './mapping/mutation.js'
import {
  assertSenderAuthorized,
  buildSubmissionEmailCreate,
  planSubmissionStatus,
} from './mapping/submission.js'

export interface MailGatewayContext {
  sessionId: string
  actorId?: string
  requestId?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface MailGatewayOptions {
  credentials: CredentialProvider
  idempotency: IdempotencyStore
  transport?: JmapTransport
  timeoutMs?: number
  sessionTtlMs?: number
  now?: () => number
  undoTtlMs?: number
}

interface UndoRecord {
  actorId: string
  accountId: string
  action: MailMutationRequest['mutation']
  update: Record<string, Record<string, unknown>>
  expiresAt: number
  consumed: boolean
}

interface ResolvedAccount {
  client: JmapClient
  upstreamAccountId: string
  accountId: string
}

const DEFAULT_SESSION_TTL_MS = 30_000

/**
 * Normalized server-side JMAP gateway (BFF) for Navin Mail.
 *
 * Browser-facing callers only pass a Navin session id and normalized requests;
 * upstream JMAP credentials and identifiers never cross this boundary. All
 * mutations and submissions are idempotent on their `idempotencyKey`.
 */
export class MailGateway {
  private readonly credentials: CredentialProvider
  private readonly idempotency: IdempotencyStore
  private readonly transport: JmapTransport | undefined
  private readonly timeoutMs: number
  private readonly sessionTtlMs: number
  private readonly now: () => number
  private readonly undoTtlMs: number
  private readonly clients = new Map<string, { client: JmapClient; expiresAt: number }>()
  private readonly undoRecords = new Map<string, UndoRecord>()

  constructor(options: MailGatewayOptions) {
    this.credentials = options.credentials
    if (!options.idempotency) {
      throw new GatewayError({
        code: 'INTERNAL_ERROR',
        message: 'A durable idempotency store is required for MailGateway',
      })
    }
    this.idempotency = options.idempotency
    this.transport = options.transport
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
    this.now = options.now ?? Date.now
    this.undoTtlMs = options.undoTtlMs ?? 5 * 60 * 1000
  }

  private actorId(ctx: MailGatewayContext): string {
    return ctx.actorId ?? `session:${ctx.sessionId}`
  }

  private invokeOptions(ctx: MailGatewayContext): JmapInvokeOptions {
    return { signal: ctx.signal, timeoutMs: ctx.timeoutMs }
  }

  private async getClient(ctx: MailGatewayContext): Promise<JmapClient> {
    const cached = this.clients.get(ctx.sessionId)
    if (cached && cached.expiresAt > this.now()) return cached.client

    const credential = await this.credentials.resolve(ctx.sessionId)
    if (!credential) {
      throw new GatewayError({
        code: 'UNAUTHORIZED',
        message: 'No upstream mail credential is available for this session',
        details: { sessionId: ctx.sessionId },
      })
    }
    const client = await JmapClient.connect({
      credential,
      transport: this.transport,
      timeoutMs: this.timeoutMs,
    })
    if (this.sessionTtlMs > 0) {
      this.clients.set(ctx.sessionId, { client, expiresAt: this.now() + this.sessionTtlMs })
    }
    return client
  }

  invalidateSession(sessionId: string): void {
    this.clients.delete(sessionId)
  }

  private async resolveAccount(
    ctx: MailGatewayContext,
    accountId: string,
  ): Promise<ResolvedAccount> {
    const client = await this.getClient(ctx)
    const upstreamAccountId = upstreamId(accountId)
    client.account(upstreamAccountId)
    return { client, upstreamAccountId, accountId }
  }

  async getSession(ctx: MailGatewayContext): Promise<NormalizedSession> {
    const client = await this.getClient(ctx)
    return toNormalizedSession(client.session)
  }

  async getAccount(ctx: MailGatewayContext, accountId: string): Promise<NormalizedAccount> {
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, accountId)
    return toNormalizedAccount(client.session, upstreamAccountId, client.account(upstreamAccountId))
  }

  private async loadMailboxes(
    client: JmapClient,
    upstreamAccountId: string,
    opts: JmapInvokeOptions,
  ): Promise<JmapMailbox[]> {
    const result = await client.invokeOne<JmapGetResult<JmapMailbox>>(
      'Mailbox/get',
      { accountId: upstreamAccountId, ids: null },
      opts,
    )
    return result.list
  }

  async listMailboxes(ctx: MailGatewayContext, accountId: string): Promise<NormalizedMailbox[]> {
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, accountId)
    requireCapability(client.capabilitiesForAccount(upstreamAccountId), JMAP_MAIL, 'listMailboxes')
    const mailboxes = await this.loadMailboxes(client, upstreamAccountId, this.invokeOptions(ctx))
    return mailboxes.map(toNormalizedMailbox)
  }

  async getMailbox(
    ctx: MailGatewayContext,
    accountId: string,
    mailboxId: string,
  ): Promise<NormalizedMailbox> {
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, accountId)
    const result = await client.invokeOne<JmapGetResult<JmapMailbox>>(
      'Mailbox/get',
      { accountId: upstreamAccountId, ids: [upstreamId(mailboxId)] },
      this.invokeOptions(ctx),
    )
    const mailbox = result.list[0]
    if (!mailbox) {
      throw new GatewayError({ code: 'NOT_FOUND', message: `Mailbox ${mailboxId} was not found` })
    }
    return toNormalizedMailbox(mailbox)
  }

  async queryMail(ctx: MailGatewayContext, request: MailQueryRequest): Promise<MailQueryResponse> {
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, request.accountId)
    const caps = client.capabilitiesForAccount(upstreamAccountId)
    requireCapability(caps, JMAP_MAIL, 'queryMail')
    const opts = this.invokeOptions(ctx)

    const queryArgs: Record<string, unknown> = {
      accountId: upstreamAccountId,
      position: request.position,
      limit: request.limit,
      calculateTotal: request.calculateTotal ?? true,
      collapseThreads: false,
      sort: buildEmailQuerySort(request.sort, caps.accountMail?.emailQuerySortOptions),
    }
    const filter = buildEmailQueryFilter(request.filter)
    if (filter) queryArgs['filter'] = filter

    const result = await client.invokeOne<JmapQueryResult>('Email/query', queryArgs, opts)
    if (result.ids.length === 0) {
      return toMailQueryResponse({ accountId: request.accountId, result, emails: [] })
    }
    const emails = await client.invokeOne<JmapGetResult<JmapEmail>>(
      'Email/get',
      { accountId: upstreamAccountId, ids: result.ids, properties: EMAIL_GET_PROPERTIES },
      opts,
    )
    return toMailQueryResponse({ accountId: request.accountId, result, emails: emails.list })
  }

  async getEmail(
    ctx: MailGatewayContext,
    accountId: string,
    messageId: string,
  ): Promise<NormalizedEmail> {
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, accountId)
    const result = await client.invokeOne<JmapGetResult<JmapEmail>>(
      'Email/get',
      {
        accountId: upstreamAccountId,
        ids: [upstreamId(messageId)],
        properties: EMAIL_GET_PROPERTIES,
      },
      this.invokeOptions(ctx),
    )
    const email = result.list[0]
    if (!email) {
      throw new GatewayError({ code: 'NOT_FOUND', message: `Message ${messageId} was not found` })
    }
    return toNormalizedEmail(email)
  }

  async getThread(
    ctx: MailGatewayContext,
    accountId: string,
    threadId: string,
  ): Promise<NormalizedThread> {
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, accountId)
    const result = await client.invokeOne<JmapGetResult<JmapThread>>(
      'Thread/get',
      { accountId: upstreamAccountId, ids: [upstreamId(threadId)] },
      this.invokeOptions(ctx),
    )
    const thread = result.list[0]
    if (!thread) {
      throw new GatewayError({ code: 'NOT_FOUND', message: `Thread ${threadId} was not found` })
    }
    return toNormalizedThread(thread)
  }

  async getEmailChanges(
    ctx: MailGatewayContext,
    accountId: string,
    sinceState: string,
  ): Promise<NormalizedChanges> {
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, accountId)
    const changes = await client.invokeOne<JmapChanges>(
      'Email/changes',
      { accountId: upstreamAccountId, sinceState },
      this.invokeOptions(ctx),
    )
    return toNormalizedChanges(changes, accountId, 'email')
  }

  async mutate(
    ctx: MailGatewayContext,
    request: MailMutationRequest,
  ): Promise<MailMutationResponse> {
    const outcome = await runIdempotent<MailMutationResponse>({
      store: this.idempotency,
      scope: `mutation:${request.accountId}`,
      key: request.idempotencyKey,
      fingerprint: fingerprint({ mutation: request.mutation, targetIds: request.targetIds }),
      now: this.now,
      produce: () => this.performMutation(ctx, request),
    })
    return outcome.value
  }

  private async performMutation(
    ctx: MailGatewayContext,
    request: MailMutationRequest,
  ): Promise<MailMutationResponse> {
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, request.accountId)
    requireCapability(client.capabilitiesForAccount(upstreamAccountId), JMAP_MAIL, 'mutate')
    const opts = this.invokeOptions(ctx)
    const targetUpstreamIds = request.targetIds.map(upstreamId)

    const fetchResult = await client.invokeOne<JmapGetResult<JmapEmail>>(
      'Email/get',
      {
        accountId: upstreamAccountId,
        ids: targetUpstreamIds,
        properties: ['id', 'mailboxIds', 'keywords'],
      },
      opts,
    )
    if (fetchResult.list.length === 0) {
      throw new GatewayError({ code: 'NOT_FOUND', message: 'None of the target messages exist' })
    }

    const mailboxes = await this.loadMailboxes(client, upstreamAccountId, opts)
    const plan = planEmailSetMutation({
      mutation: request,
      targets: fetchResult.list.map((email) => ({ upstreamId: email.id, email })),
      mailboxes,
    })

    if (typeof fetchResult.state !== 'string' || fetchResult.state.length === 0) {
      throw new GatewayError({
        code: 'PRECONDITION_FAILED',
        message: 'Upstream did not provide an Email state for optimistic mutation protection',
      })
    }
    const setArgs: Record<string, unknown> = {
      accountId: upstreamAccountId,
      ifInState: fetchResult.state,
    }
    if (Object.keys(plan.update).length > 0) setArgs['update'] = plan.update
    if (plan.destroy.length > 0) setArgs['destroy'] = plan.destroy

    const setResult = await client.invokeOne<JmapSetResult>('Email/set', setArgs, opts)
    throwIfSetFailed(setResult, 'mutation')

    const response: MailMutationResponse = {
      success: true,
      idempotencyKey: request.idempotencyKey,
      affectedCount: plan.affected,
      newState: setResult.newState,
    }

    if (Object.keys(plan.update).length > 0) {
      response.undoToken = this.recordUndo(ctx, request.accountId, request.mutation, plan.update)
    }
    return response
  }

  private recordUndo(
    ctx: MailGatewayContext,
    accountId: string,
    action: MailMutationRequest['mutation'],
    update: Record<string, Record<string, unknown>>,
  ): string {
    const inverse: Record<string, Record<string, unknown>> = {}
    for (const [id, patch] of Object.entries(update)) {
      const inverted: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(patch)) {
        inverted[key] = value === true ? null : true
      }
      inverse[id] = inverted
    }
    const token = randomUUID()
    this.undoRecords.set(token, {
      actorId: this.actorId(ctx),
      accountId,
      action,
      update: inverse,
      expiresAt: this.now() + this.undoTtlMs,
      consumed: false,
    })
    return token
  }

  async undoMutation(
    ctx: MailGatewayContext,
    undoToken: string,
    expectedAction?: MailMutationRequest['mutation'],
  ): Promise<{ undone: boolean }> {
    const record = this.undoRecords.get(undoToken)
    if (
      !record ||
      record.expiresAt <= this.now() ||
      record.consumed ||
      record.actorId !== this.actorId(ctx) ||
      (expectedAction !== undefined && record.action !== expectedAction)
    ) {
      throw new GatewayError({ code: 'NOT_FOUND', message: 'Undo token is unknown or has expired' })
    }
    record.consumed = true
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, record.accountId)
    const current = await client.invokeOne<JmapGetResult<JmapEmail>>(
      'Email/get',
      { accountId: upstreamAccountId, ids: Object.keys(record.update), properties: ['id'] },
      this.invokeOptions(ctx),
    )
    if (typeof current.state !== 'string' || current.state.length === 0) {
      throw new GatewayError({
        code: 'PRECONDITION_FAILED',
        message: 'Upstream did not provide an Email state for undo protection',
      })
    }
    const setResult = await client.invokeOne<JmapSetResult>(
      'Email/set',
      { accountId: upstreamAccountId, ifInState: current.state, update: record.update },
      this.invokeOptions(ctx),
    )
    throwIfSetFailed(setResult, 'undoMutation')
    this.undoRecords.delete(undoToken)
    return { undone: true }
  }

  async submit(
    ctx: MailGatewayContext,
    request: MailSubmissionRequest,
  ): Promise<MailSubmissionResponse> {
    const outcome = await runIdempotent<MailSubmissionResponse>({
      store: this.idempotency,
      scope: `submission:${request.accountId}`,
      key: request.idempotencyKey,
      fingerprint: fingerprint({
        senderIdentityId: request.senderIdentityId,
        from: request.from,
        to: request.to.map((entry) => entry.address),
        subject: request.subject,
        sendAt: request.sendAt ?? null,
      }),
      now: this.now,
      produce: () => this.performSubmission(ctx, request),
    })
    return outcome.value
  }

  private async performSubmission(
    ctx: MailGatewayContext,
    request: MailSubmissionRequest,
  ): Promise<MailSubmissionResponse> {
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, request.accountId)
    const caps = client.capabilitiesForAccount(upstreamAccountId)
    requireCapability(caps, JMAP_MAIL, 'submit')
    requireCapability(caps, JMAP_SUBMISSION, 'submit')
    const opts = this.invokeOptions(ctx)

    const identitiesResult = await client.invokeOne<JmapGetResult<JmapIdentity>>(
      'Identity/get',
      { accountId: upstreamAccountId, ids: null },
      opts,
    )
    const identity = resolveIdentity(
      identitiesResult.list,
      request.senderIdentityId,
      request.from.address,
    )
    assertSenderAuthorized(identity, request.from)

    const mailboxes = await this.loadMailboxes(client, upstreamAccountId, opts)
    const drafts = findMailboxByRole(mailboxes, 'drafts')
    if (!drafts) {
      throw new GatewayError({
        code: 'ACTION_BLOCKED',
        message: 'Upstream account has no Drafts mailbox required for submission',
      })
    }

    const nowMs = this.now()
    const statusPlan = planSubmissionStatus(
      request,
      nowMs,
      caps.uris.has(SCHEDULED_SEND_CAPABILITY),
    )
    const emailCreate = buildSubmissionEmailCreate(request, drafts.id)

    const emailState = await client.invokeOne<JmapGetResult<JmapEmail>>(
      'Email/get',
      { accountId: upstreamAccountId, ids: [], properties: ['id'] },
      opts,
    )
    if (typeof emailState.state !== 'string' || emailState.state.length === 0) {
      throw new GatewayError({
        code: 'PRECONDITION_FAILED',
        message: 'Upstream did not provide an Email state for submission protection',
      })
    }
    const emailSetResult = await client.invokeOne<JmapSetResult>(
      'Email/set',
      { accountId: upstreamAccountId, ifInState: emailState.state, create: { draft: emailCreate } },
      opts,
    )
    throwIfSetFailed(emailSetResult, 'submit:createDraft')
    const createdEmail = readCreated<{ id?: unknown }>(emailSetResult, 'draft')
    const emailUpstreamId = typeof createdEmail.id === 'string' ? createdEmail.id : undefined
    if (!emailUpstreamId) {
      throw new GatewayError({
        code: 'INTERNAL_ERROR',
        message: 'Upstream did not return an id for the created draft',
      })
    }

    const submissionCreate: Record<string, unknown> = {
      identityId: identity.id,
      emailId: emailUpstreamId,
    }
    if (statusPlan.useScheduledSendExtension) {
      submissionCreate['undoDelaySeconds'] = statusPlan.undoDelaySeconds
      if (statusPlan.sendAt) submissionCreate['sendAt'] = statusPlan.sendAt
    }

    const submissionState = await client.invokeOne<JmapGetResult<JmapEmailSubmission>>(
      'EmailSubmission/get',
      { accountId: upstreamAccountId, ids: [], properties: ['id'] },
      opts,
    )
    if (typeof submissionState.state !== 'string' || submissionState.state.length === 0) {
      throw new GatewayError({
        code: 'PRECONDITION_FAILED',
        message: 'Upstream did not provide a submission state for optimistic protection',
      })
    }
    const submissionSetResult = await client.invokeOne<JmapSetResult>(
      'EmailSubmission/set',
      {
        accountId: upstreamAccountId,
        ifInState: submissionState.state,
        create: { sub: submissionCreate },
      },
      opts,
    )
    throwIfSetFailed(submissionSetResult, 'submit:createSubmission')
    const createdSubmission = readCreated<JmapEmailSubmission>(submissionSetResult, 'sub')
    if (typeof createdSubmission.id !== 'string') {
      throw new GatewayError({
        code: 'INTERNAL_ERROR',
        message: 'Upstream did not return a submission id',
      })
    }

    const response: MailSubmissionResponse = {
      submissionId: encodeId('sub', createdSubmission.id),
      idempotencyKey: request.idempotencyKey,
      messageId: encodeId('msg', emailUpstreamId) as MessageId,
      status: statusPlan.status,
      submittedAt: new Date(nowMs).toISOString(),
    }
    if (statusPlan.undoWindowExpiresAt)
      response.undoWindowExpiresAt = statusPlan.undoWindowExpiresAt
    return response
  }

  async cancelSubmission(
    ctx: MailGatewayContext,
    accountId: string,
    submissionId: string,
  ): Promise<{ canceled: boolean }> {
    const { client, upstreamAccountId } = await this.resolveAccount(ctx, accountId)
    const current = await client.invokeOne<JmapGetResult<JmapEmailSubmission>>(
      'EmailSubmission/get',
      { accountId: upstreamAccountId, ids: [upstreamId(submissionId)], properties: ['id'] },
      this.invokeOptions(ctx),
    )
    if (typeof current.state !== 'string' || current.state.length === 0) {
      throw new GatewayError({
        code: 'PRECONDITION_FAILED',
        message: 'Upstream did not provide a submission state for cancellation protection',
      })
    }
    const setResult = await client.invokeOne<JmapSetResult>(
      'EmailSubmission/set',
      {
        accountId: upstreamAccountId,
        ifInState: current.state,
        update: { [upstreamId(submissionId)]: { undoStatus: 'canceled' } },
      },
      this.invokeOptions(ctx),
    )
    throwIfSetFailed(setResult, 'cancelSubmission')
    return { canceled: true }
  }
}

function resolveIdentity(
  identities: readonly JmapIdentity[],
  senderIdentityId: string,
  fromAddress: string,
): JmapIdentity {
  const wanted = upstreamId(senderIdentityId)
  const byId = identities.find((identity) => identity.id === wanted)
  if (byId) return byId
  const byEmail = identities.find(
    (identity) => identity.email.toLowerCase() === fromAddress.toLowerCase(),
  )
  if (byEmail) return byEmail
  throw new GatewayError({
    code: 'FORBIDDEN',
    message: 'No sender identity is authorized for the requested From address',
    details: { senderIdentityId },
  })
}

function readCreated<T>(result: JmapSetResult, creationId: string): T {
  const created = result.created?.[creationId]
  if (!created || typeof created !== 'object') {
    throw new GatewayError({
      code: 'INTERNAL_ERROR',
      message: `Upstream did not confirm creation of "${creationId}"`,
    })
  }
  return created as T
}

function throwIfSetFailed(result: JmapSetResult, operation: string): void {
  const notCreated = result.notCreated ?? {}
  const notUpdated = result.notUpdated ?? {}
  const notDestroyed = result.notDestroyed ?? {}
  const firstCreated = Object.values(notCreated)[0]
  if (firstCreated) throw gatewayErrorFromJmapMethod(firstCreated, { operation, phase: 'create' })
  const firstUpdated = Object.values(notUpdated)[0]
  if (firstUpdated) throw gatewayErrorFromJmapMethod(firstUpdated, { operation, phase: 'update' })
  const firstDestroyed = Object.values(notDestroyed)[0]
  if (firstDestroyed)
    throw gatewayErrorFromJmapMethod(firstDestroyed, { operation, phase: 'destroy' })
}
