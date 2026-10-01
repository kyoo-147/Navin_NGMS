import { randomUUID } from 'node:crypto'
import type { MailMutationRequest, MailSubmissionRequest } from '@navin/contracts'
import type { MailGateway, MailGatewayContext } from '@navin/mail-gateway'
import type { ConflictRecord, MailStore, OutboxItem } from './store.js'

export interface ReconcilerOptions {
  store: MailStore
  gateway: MailGateway
  ctxFactory: (accountId: string) => MailGatewayContext
  onConflict?: (conflict: ConflictRecord) => void
}

export interface ReconcileResult {
  processed: number
  sent: number
  failed: number
  conflicts: ConflictRecord[]
}

export class OutboxReconciler {
  private readonly store: MailStore
  private readonly gateway: MailGateway
  private readonly ctxFactory: (accountId: string) => MailGatewayContext
  private readonly onConflict?: (conflict: ConflictRecord) => void

  constructor(options: ReconcilerOptions) {
    this.store = options.store
    this.gateway = options.gateway
    this.ctxFactory = options.ctxFactory
    this.onConflict = options.onConflict
  }

  /**
   * Replays pending outbox items in dependency order.
   * Guarantees:
   * 1. Items with unresolved dependencies are skipped until their dependency succeeds.
   * 2. Already sent items are never resent (idempotency).
   * 3. Failed items transition to 'needs_attention' with an associated ConflictRecord.
   */
  async reconcileOutbox(accountId?: string): Promise<ReconcileResult> {
    const items = this.store.listOutbox(accountId)
    const result: ReconcileResult = {
      processed: 0,
      sent: 0,
      failed: 0,
      conflicts: [],
    }

    // Index status by outbox ID for dependency resolution
    const statusMap = new Map<string, OutboxItem['status']>()
    for (const item of items) {
      statusMap.set(item.id, item.status)
    }

    for (const item of items) {
      if (item.status !== 'pending') {
        continue
      }

      // Check dependency
      if (item.dependencyId) {
        const depStatus = statusMap.get(item.dependencyId)
        if (depStatus !== 'sent') {
          // Cannot process yet until dependency is sent
          continue
        }
      }

      if (!this.store.markOutboxProcessing(item.id)) continue
      result.processed++
      statusMap.set(item.id, 'processing')

      const ctx = this.ctxFactory(item.accountId)

      try {
        if (item.kind === 'mutation') {
          await this.gateway.mutate(ctx, item.payload as unknown as MailMutationRequest)
          this.store.markOutboxSent(item.id)
          statusMap.set(item.id, 'sent')
          result.sent++
        } else if (item.kind === 'submission') {
          await this.gateway.submit(ctx, item.payload as unknown as MailSubmissionRequest)
          this.store.markOutboxSent(item.id)
          statusMap.set(item.id, 'sent')
          result.sent++
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        this.store.markOutboxAttention(item.id, message)
        statusMap.set(item.id, 'needs_attention')
        result.failed++

        const conflict = this.store.addConflict({
          id: randomUUID(),
          accountId: item.accountId,
          outboxId: item.id,
          reason: item.kind === 'submission' ? 'submission_failed' : 'mutation_conflict',
          detail: message,
        })
        result.conflicts.push(conflict)
        this.onConflict?.(conflict)
      }
    }

    return result
  }

  /**
   * Synchronizes remote mailbox hierarchy and message deltas for an account.
   */
  async syncMailbox(accountId: string): Promise<void> {
    const ctx = this.ctxFactory(accountId)
    const remoteMailboxes = await this.gateway.listMailboxes(ctx, accountId)
    this.store.putMailboxes(accountId, remoteMailboxes)

    const sinceState = this.store.getSyncState(accountId)
    if (sinceState) {
      try {
        let cursor = sinceState
        for (let page = 0; page < 1_000; page++) {
          const changes = await this.gateway.getEmailChanges(ctx, accountId, cursor)
          for (const createdOrUpdatedId of [...changes.created, ...changes.updated]) {
            const email = await this.gateway.getEmail(ctx, accountId, createdOrUpdatedId)
            this.store.putMessage(email, accountId)
          }
          for (const destroyedId of changes.destroyed) {
            this.store.removeMessage(accountId, destroyedId)
          }
          if (!changes.hasMoreChanges) {
            this.store.setSyncState(accountId, changes.newState)
            return
          }
          if (changes.newState === cursor) {
            throw new Error('Mail change cursor did not advance')
          }
          cursor = changes.newState
        }
        throw new Error('Mail change pagination exceeded the safety limit')
      } catch {
        // An invalid/expired state falls through to a complete bounded resync.
      }
    }

    let position = 0
    let finalQueryState: string | null = null
    for (let page = 0; page < 1_000; page++) {
      const queryResult = await this.gateway.queryMail(ctx, {
        accountId,
        position,
        limit: 500,
      })
      finalQueryState = queryResult.queryState
      for (const msgId of queryResult.messageIds) {
        const email = await this.gateway.getEmail(ctx, accountId, msgId)
        this.store.putMessage(email, accountId)
      }
      position += queryResult.messageIds.length
      if (position >= queryResult.total) break
      if (queryResult.messageIds.length === 0) {
        throw new Error('Mail query pagination did not advance')
      }
      if (page === 999) throw new Error('Mail query pagination exceeded the safety limit')
    }
    if (finalQueryState) this.store.setSyncState(accountId, finalQueryState)
  }
}
