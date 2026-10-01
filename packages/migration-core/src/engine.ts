import { randomUUID } from 'node:crypto'

import { computeMessageFingerprint } from './fingerprint.js'
import { asErrorMessage, isAbortRequested, itemKey, MigrationStore } from './store.js'
import type {
  DeltaPage,
  InventoryItem,
  MigrationFailure,
  MigrationRunOptions,
  MigrationSourceAdapter,
  MigrationSummary,
  MigrationTargetPort,
  SourceMessage,
} from './types.js'

export interface MigrationCoreOptions {
  store: MigrationStore
  source: MigrationSourceAdapter
  target: MigrationTargetPort
  defaultConcurrency?: number
}

export class MigrationCore {
  private readonly concurrency: number
  private readonly inFlightFingerprints = new Map<string, Promise<void>>()
  private readonly inFlightKeys = new Map<string, Promise<void>>()

  constructor(private readonly options: MigrationCoreOptions) {
    this.concurrency = boundedConcurrency(options.defaultConcurrency ?? 4)
  }

  createMigration(concurrency = this.concurrency): string {
    const id = randomUUID()
    this.options.store.create(id, this.options.source.protocol, boundedConcurrency(concurrency))
    return id
  }

  requestCancellation(migrationId: string): void {
    this.options.store.requestCancellation(migrationId)
  }

  async run(migrationId: string, runOptions: MigrationRunOptions = {}): Promise<MigrationSummary> {
    const { store, source } = this.options
    const record = store.get(migrationId)
    if (record.status === 'completed' && record.failures.length === 0)
      return this.summary(migrationId)

    if (runOptions.resume || record.status === 'failed' || record.status === 'cancelled') {
      store.clearCancellation(migrationId)
      store.resetRunningItems(migrationId)
    }
    store.setStatus(migrationId, 'running')

    try {
      if (!record.baselineDone) {
        await this.runBaseline(migrationId, runOptions)
      } else {
        await this.retryPendingOrFailedItems(migrationId, runOptions)
      }
      if (this.shouldStop(migrationId, runOptions.signal)) return this.finishCancelled(migrationId)
      await this.runDelta(migrationId, runOptions)
      if (this.shouldStop(migrationId, runOptions.signal)) return this.finishCancelled(migrationId)
      if (source.reconcile !== undefined) {
        const reconciliation = await source.reconcile()
        await this.processItems(migrationId, reconciliation.items, 'reconcile', runOptions)
        await this.processDeleted(migrationId, reconciliation.deleted, 'reconcile')
      }
      if (this.shouldStop(migrationId, runOptions.signal)) return this.finishCancelled(migrationId)
      const completed = store.get(migrationId)
      store.setStatus(migrationId, completed.failures.length === 0 ? 'completed' : 'failed')
    } catch (error) {
      const message = asErrorMessage(error)
      const current = store.get(migrationId)
      if (current.cancellationRequested || isAbortRequested(runOptions.signal)) {
        return this.finishCancelled(migrationId)
      }
      store.appendFailure(migrationId, {
        itemKey: '*migration*',
        phase: current.baselineDone ? 'delta' : 'baseline',
        code: 'SOURCE_FETCH_FAILED',
        message,
        retryable: true,
      })
      store.setStatus(migrationId, 'failed')
    }
    return this.summary(migrationId)
  }

  getState(migrationId: string) {
    return this.options.store.get(migrationId)
  }

  private async runBaseline(migrationId: string, runOptions: MigrationRunOptions): Promise<void> {
    let cursor = this.options.store.get(migrationId).baselineCursor
    while (true) {
      if (this.shouldStop(migrationId, runOptions.signal)) return
      const page = await this.options.source.inventory(cursor)
      await this.processItems(migrationId, page.items, 'baseline', runOptions)
      cursor = page.nextCursor
      this.options.store.setBaselineCursor(migrationId, cursor, cursor === undefined)
      if (cursor === undefined) return
    }
  }

  private async runDelta(migrationId: string, runOptions: MigrationRunOptions): Promise<void> {
    let cursor = this.options.store.get(migrationId).deltaCursor
    while (true) {
      if (this.shouldStop(migrationId, runOptions.signal)) return
      const page: DeltaPage = await this.options.source.delta(cursor)
      await this.processItems(migrationId, page.items, 'delta', runOptions)
      await this.processDeleted(migrationId, page.deleted, 'delta')
      cursor = page.nextCursor
      this.options.store.setDeltaCursor(migrationId, cursor)
      if (cursor === undefined) return
    }
  }

  private async retryPendingOrFailedItems(
    migrationId: string,
    runOptions: MigrationRunOptions,
  ): Promise<void> {
    const uncompleted = this.options.store.getPendingOrFailedItems(migrationId)
    if (uncompleted.length === 0) return
    const items = uncompleted.map((entry) => entry.item)
    await this.processItems(migrationId, items, 'baseline', runOptions)
  }

  private async processItems(
    migrationId: string,
    items: InventoryItem[],
    phase: 'baseline' | 'delta' | 'reconcile',
    runOptions: MigrationRunOptions,
  ): Promise<void> {
    const concurrency = storeConcurrency(this.options.store.get(migrationId).concurrency)
    for (let offset = 0; offset < items.length; offset += concurrency) {
      if (this.shouldStop(migrationId, runOptions.signal)) return
      const batch = items.slice(offset, offset + concurrency)
      await Promise.all(
        batch.map((item) => this.importItem(migrationId, item, phase, runOptions.signal)),
      )
    }
  }

  private async importItem(
    migrationId: string,
    item: InventoryItem,
    phase: 'baseline' | 'delta' | 'reconcile',
    signal?: AbortSignal,
  ): Promise<void> {
    const { store, source, target } = this.options
    let key: string
    try {
      key = store.ensureItem(migrationId, item, item.fingerprint)
    } catch (error) {
      store.appendFailure(
        migrationId,
        this.failure('*invalid*', phase, 'INVALID_ITEM', asErrorMessage(error), false),
      )
      return
    }

    // Await any in-flight execution for the same item key to prevent race conditions
    while (this.inFlightKeys.has(key)) {
      await this.inFlightKeys.get(key)
    }
    let releaseKey: () => void = () => {}
    const keyPromise = new Promise<void>((resolve) => {
      releaseKey = resolve
    })
    this.inFlightKeys.set(key, keyPromise)

    try {
      const state = store.getItem(migrationId, key)
      if (state?.state === 'completed') {
        store.addCounter(migrationId, 'duplicate_prevented')
        return
      }

      // Check if duplicate by fingerprint before fetching
      if (item.fingerprint) {
        while (this.inFlightFingerprints.has(item.fingerprint)) {
          await this.inFlightFingerprints.get(item.fingerprint)
        }
        const existingFp = store.findCompletedByFingerprint(migrationId, item.fingerprint)
        if (existingFp?.targetId) {
          store.markCompleted(migrationId, key, existingFp.targetId, item.fingerprint)
          store.removeFailure(migrationId, key)
          store.addCounter(migrationId, 'duplicate_prevented')
          return
        }
      }

      // Check if duplicate by messageId before fetching
      if (item.messageId) {
        const existingMsg = store.findCompletedByMessageId(migrationId, item.messageId)
        if (existingMsg?.targetId) {
          store.markCompleted(migrationId, key, existingMsg.targetId, item.fingerprint)
          store.removeFailure(migrationId, key)
          store.addCounter(migrationId, 'duplicate_prevented')
          return
        }
      }

      if (isAbortRequested(signal) || store.isCancellationRequested(migrationId)) {
        store.markFailed(migrationId, key, 'Cancellation requested before import')
        store.appendFailure(
          migrationId,
          this.failure(key, phase, 'CANCELLED', 'Cancellation requested', true),
        )
        return
      }

      store.markRunning(migrationId, key)
      let message: SourceMessage
      try {
        message = await source.fetchMessage(item)
        validateMessage(message)
      } catch (error) {
        const text = asErrorMessage(error)
        store.markFailed(migrationId, key, text)
        store.appendFailure(
          migrationId,
          this.failure(key, phase, 'SOURCE_FETCH_FAILED', text, true),
        )
        return
      }

      // Post-fetch fingerprint deduplication
      const fingerprint = item.fingerprint ?? computeMessageFingerprint(message)
      store.setFingerprint(migrationId, key, fingerprint)

      while (this.inFlightFingerprints.has(fingerprint)) {
        await this.inFlightFingerprints.get(fingerprint)
      }
      const existingAfterFetch = store.findCompletedByFingerprint(migrationId, fingerprint)
      if (existingAfterFetch?.targetId) {
        store.markCompleted(migrationId, key, existingAfterFetch.targetId, fingerprint)
        store.removeFailure(migrationId, key)
        store.addCounter(migrationId, 'duplicate_prevented')
        return
      }

      // Register in-flight fingerprint lock
      let releaseFp: () => void = () => {}
      const fpPromise = new Promise<void>((resolve) => {
        releaseFp = resolve
      })
      this.inFlightFingerprints.set(fingerprint, fpPromise)

      try {
        const idempotencyKey = `navin-migration:${migrationId}:${fingerprint}`
        const result = await target.upsertMessage(message, idempotencyKey)
        store.markCompleted(migrationId, key, result.targetId, fingerprint)
        store.removeFailure(migrationId, key)
        store.addCounter(
          migrationId,
          phase === 'baseline'
            ? 'baseline_imported'
            : phase === 'delta'
              ? 'delta_imported'
              : 'reconciled',
        )
      } catch (error) {
        const text = asErrorMessage(error)
        store.markFailed(migrationId, key, text)
        store.appendFailure(
          migrationId,
          this.failure(key, phase, 'TARGET_WRITE_FAILED', text, true),
        )
      } finally {
        this.inFlightFingerprints.delete(fingerprint)
        releaseFp()
      }
    } finally {
      this.inFlightKeys.delete(key)
      releaseKey()
    }
  }

  private async processDeleted(
    migrationId: string,
    items: InventoryItem[],
    phase: 'delta' | 'reconcile',
  ): Promise<void> {
    const { store, target } = this.options
    if (target.deleteMessage === undefined) {
      for (const item of items) {
        store.appendFailure(
          migrationId,
          this.failure(
            itemKeySafe(item),
            phase === 'delta' ? 'delete' : 'delete',
            'TARGET_DELETE_FAILED',
            'Target does not support deletion',
            false,
          ),
        )
      }
      return
    }
    for (const item of items) {
      const key = store.ensureItem(migrationId, item)
      try {
        await target.deleteMessage(item, `navin-migration-delete:${migrationId}:${key}`)
        store.markDeleted(migrationId, key)
        store.addCounter(migrationId, 'deleted')
      } catch (error) {
        const text = asErrorMessage(error)
        store.markFailed(migrationId, key, text)
        store.appendFailure(
          migrationId,
          this.failure(key, 'delete', 'TARGET_DELETE_FAILED', text, true),
        )
      }
    }
  }

  private shouldStop(migrationId: string, signal?: AbortSignal): boolean {
    return this.options.store.isCancellationRequested(migrationId) || isAbortRequested(signal)
  }

  private finishCancelled(migrationId: string): MigrationSummary {
    this.options.store.setStatus(migrationId, 'cancelled')
    return this.summary(migrationId)
  }

  private summary(migrationId: string): MigrationSummary {
    const record = this.options.store.get(migrationId)
    return {
      migrationId,
      status: record.status === 'created' || record.status === 'running' ? 'failed' : record.status,
      ...record.counters,
      failures: record.failures,
      cancellationRequested: record.cancellationRequested,
    }
  }

  private failure(
    key: string,
    phase: MigrationFailure['phase'],
    code: MigrationFailure['code'],
    message: string,
    retryable: boolean,
  ): MigrationFailure {
    return { itemKey: key, phase, code, message, retryable }
  }
}

function boundedConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(32, Math.max(1, Math.trunc(value)))
}

function storeConcurrency(value: number): number {
  return boundedConcurrency(value)
}

function itemKeySafe(item: InventoryItem): string {
  try {
    return itemKey(item)
  } catch {
    return '*invalid*'
  }
}

function validateMessage(message: SourceMessage): void {
  if (!(message.rawRfc822 instanceof Uint8Array)) throw new Error('rawRfc822 must be a Uint8Array')
  if (
    message.identity.sourceUid === undefined &&
    message.identity.sourceId === undefined &&
    message.identity.messageId === undefined
  ) {
    throw new Error('message identity is missing')
  }
  for (const attachment of message.attachments) {
    if (!(attachment.content instanceof Uint8Array))
      throw new Error(`attachment ${attachment.filename} is not bytes`)
  }
}
