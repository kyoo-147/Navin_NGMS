import { generateUUID } from '../utils/uuid.js'
import type {
  MailMutationRequest,
  MailMutationResponse,
  MailQueryRequest,
  MailSubmissionResponse,
} from '@navin/contracts'
import type {
  MailGateway,
  MailGatewayContext,
  NormalizedEmail,
  NormalizedMailbox,
} from '@navin/mail-gateway'
import {
  type ConflictRecord,
  type DraftRecord,
  type MailStore,
  OutboxReconciler,
} from '@navin/mail-store'
import { groupEmailsIntoThreads, type ThreadSummary } from '../thread/threader.js'
import {
  buildSubmissionRequest,
  type SubmissionOptions,
  UndoSendManager,
} from '../submission/submission-handler.js'
import { ContactsManager } from '../contacts/contacts-manager.js'
import { CalendarManager } from '../calendar/calendar-manager.js'
import { RealtimeSyncManager } from '../realtime/realtime-sync.js'
import {
  evaluateServerCapabilities,
  type ServerCapabilities,
} from '../capabilities/capabilities.js'

export interface MailClientOptions {
  store: MailStore
  gateway: MailGateway
  ctxFactory: (accountId: string) => MailGatewayContext
  initialOnline?: boolean
  autoReconcile?: boolean
}

/**
 * Unified MailClient orchestrator for Navin Mail.
 * Bridges local SQLite store (cache + durable outbox) with the normalized server gateway.
 * Seamlessly manages offline mutations, draft autosaves, outbox reconciliation,
 * thread grouping, contacts, calendar, and undo-send windows.
 */
export class MailClient {
  readonly store: MailStore
  readonly gateway: MailGateway
  readonly reconciler: OutboxReconciler
  readonly undoManager: UndoSendManager
  readonly realtime: RealtimeSyncManager
  readonly contacts: ContactsManager
  readonly calendar: CalendarManager

  private online: boolean
  private readonly autoReconcile: boolean
  private readonly ctxFactory: (accountId: string) => MailGatewayContext
  private serverCaps: ServerCapabilities

  constructor(options: MailClientOptions) {
    this.store = options.store
    this.gateway = options.gateway
    this.ctxFactory = options.ctxFactory
    this.online = options.initialOnline ?? true
    this.autoReconcile = options.autoReconcile ?? true
    this.undoManager = new UndoSendManager()
    this.realtime = new RealtimeSyncManager({
      onPoll: async (accId) => {
        if (this.online) {
          await this.syncMailbox(accId)
        }
      },
    })
    this.contacts = new ContactsManager()
    this.calendar = new CalendarManager()
    this.serverCaps = evaluateServerCapabilities({})

    this.reconciler = new OutboxReconciler({
      store: this.store,
      gateway: this.gateway,
      ctxFactory: this.ctxFactory,
    })
  }

  isOnline(): boolean {
    return this.online
  }

  setOnline(online: boolean): void {
    const wasOffline = !this.online && online
    this.online = online
    if (wasOffline && this.autoReconcile) {
      // Reconnected! Reconcile offline outbox immediately
      void this.reconcileAll()
    }
  }

  getCapabilities(): ServerCapabilities {
    return this.serverCaps
  }

  setCapabilities(caps: Record<string, unknown>): void {
    this.serverCaps = evaluateServerCapabilities(caps)
  }

  async listMailboxes(accountId: string): Promise<NormalizedMailbox[]> {
    if (this.online) {
      try {
        const ctx = this.ctxFactory(accountId)
        const remote = await this.gateway.listMailboxes(ctx, accountId)
        this.store.putMailboxes(accountId, remote)
        return remote
      } catch (error: unknown) {
        if (!isOfflineError(error)) throw error
      }
    }
    return this.store.listMailboxes(accountId)
  }

  async queryThreads(
    accountId: string,
    request: MailQueryRequest,
  ): Promise<{ threads: ThreadSummary[]; total: number }> {
    if (this.online) {
      try {
        const ctx = this.ctxFactory(accountId)
        const response = await this.gateway.queryMail(ctx, request)

        // Fetch full message records
        const emails: NormalizedEmail[] = []
        for (const msgId of response.messageIds) {
          const email = await this.gateway.getEmail(ctx, accountId, msgId)
          this.store.putMessage(email, accountId)
          emails.push(email)
        }

        const threads = groupEmailsIntoThreads(emails)
        return { threads, total: response.total }
      } catch (error: unknown) {
        if (!isOfflineError(error)) throw error
      }
    }

    // Offline cached query
    const cached = this.store.queryCachedMessages(accountId, {
      inMailbox: request.filter?.inMailbox,
      isUnread: request.filter?.isUnread,
      isStarred: request.filter?.isStarred,
      limit: request.limit,
    })

    const threads = groupEmailsIntoThreads(cached)
    return { threads, total: threads.length }
  }

  async getThread(accountId: string, threadId: string): Promise<NormalizedEmail[]> {
    if (this.online) {
      try {
        const ctx = this.ctxFactory(accountId)
        const remoteThread = await this.gateway.getThread(ctx, accountId, threadId as any)
        const emails: NormalizedEmail[] = []
        for (const msgId of remoteThread.messageIds) {
          const email = await this.gateway.getEmail(ctx, accountId, msgId)
          this.store.putMessage(email, accountId)
          emails.push(email)
        }
        return emails
      } catch (error: unknown) {
        if (!isOfflineError(error)) throw error
      }
    }
    return this.store.getThread(accountId, threadId as any)
  }

  /**
   * Dispatches a mutation if online; queues in SQLite outbox if offline.
   */
  async mutate(
    accountId: string,
    mutationReq: Omit<MailMutationRequest, 'accountId'>,
  ): Promise<MailMutationResponse> {
    const fullReq = { ...mutationReq, accountId } as MailMutationRequest
    const queued = this.store.enqueue({
      id: `mut-${generateUUID()}`,
      accountId,
      kind: 'mutation',
      idempotencyKey: fullReq.idempotencyKey,
      payload: fullReq as unknown as Record<string, unknown>,
      dependencyId: null,
    })

    if (this.online && queued.status === 'pending' && this.store.markOutboxProcessing(queued.id)) {
      try {
        const response = await this.gateway.mutate(this.ctxFactory(accountId), fullReq)
        this.store.markOutboxSent(queued.id)
        return response
      } catch (error: unknown) {
        if (!isOfflineError(error)) {
          this.store.markOutboxAttention(queued.id, errorMessage(error))
          throw error
        }
        this.store.markOutboxPending(queued.id, errorMessage(error))
      }
    }

    return {
      success: false,
      idempotencyKey: fullReq.idempotencyKey,
      affectedCount: 0,
      newState: 'offline-queued',
    }
  }

  async undoMutation(accountId: string, undoToken: string): Promise<{ undone: boolean }> {
    const ctx = this.ctxFactory(accountId)
    return this.gateway.undoMutation(ctx, undoToken)
  }

  /**
   * Submits a draft. Respects client-side undo window and offline durable outbox.
   */
  async submitDraft(
    draft: DraftRecord,
    options: SubmissionOptions,
  ): Promise<MailSubmissionResponse> {
    const submissionRequest = buildSubmissionRequest(draft, options)

    const doSubmit = async (): Promise<MailSubmissionResponse> => {
      const queued = this.store.enqueue({
        id: `sub-${generateUUID()}`,
        accountId: draft.accountId,
        kind: 'submission',
        idempotencyKey: submissionRequest.idempotencyKey,
        payload: submissionRequest as unknown as Record<string, unknown>,
        dependencyId: null,
      })

      if (
        this.online &&
        queued.status === 'pending' &&
        this.store.markOutboxProcessing(queued.id)
      ) {
        try {
          const response = await this.gateway.submit(
            this.ctxFactory(draft.accountId),
            submissionRequest,
          )
          this.store.markOutboxSent(queued.id)
          this.store.upsertDraft({ ...draft, status: 'sent' })
          return response
        } catch (error: unknown) {
          if (!isOfflineError(error)) {
            this.store.markOutboxAttention(queued.id, errorMessage(error))
            throw error
          }
          this.store.markOutboxPending(queued.id, errorMessage(error))
        }
      }

      this.store.upsertDraft({ ...draft, status: 'scheduled' })

      return {
        submissionId: `local-sub-${generateUUID()}`,
        idempotencyKey: submissionRequest.idempotencyKey,
        messageId: `local-msg-${generateUUID()}` as any,
        status: 'queued',
        submittedAt: new Date().toISOString(),
      }
    }

    const delay = options.undoDelaySeconds ?? 5
    if (delay > 0) {
      return this.undoManager.scheduleWithUndo(submissionRequest.idempotencyKey, delay, doSubmit)
    }

    return doSubmit()
  }

  cancelUndo(idempotencyKey: string): boolean {
    return this.undoManager.cancel(idempotencyKey)
  }

  async reconcileAll(): Promise<{ sent: number; failed: number; conflicts: ConflictRecord[] }> {
    const res = await this.reconciler.reconcileOutbox()
    const accounts = this.store.listAccounts()
    for (const acc of accounts) {
      try {
        await this.syncMailbox(acc.id)
      } catch {
        // continue
      }
    }
    return res
  }

  async syncMailbox(accountId: string): Promise<void> {
    if (!this.online) return
    await this.reconciler.syncMailbox(accountId)
  }
}

function isOfflineError(err: unknown): boolean {
  if (!err) return false
  const msg = err instanceof Error ? err.message : String(err)
  return /network|fetch|offline|econnrefused|etimedout|enotfound/i.test(msg)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
