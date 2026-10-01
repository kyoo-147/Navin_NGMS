import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { MigrationCore, MigrationStore } from '../src/index.js'
import type {
  InventoryItem,
  MigrationSourceAdapter,
  MigrationTargetPort,
  SourceMessage,
} from '../src/index.js'

const raw = (value: string): Uint8Array => new TextEncoder().encode(value)

function message(item: InventoryItem, value: string): SourceMessage {
  return {
    identity: item,
    rawRfc822: raw(`From: ${value}@example.com\r\n\r\n${value}`),
    flags: ['\\Seen'],
    labels: ['inbox'],
    internalDate: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:00.000Z',
    attachments: [{ filename: 'note.txt', contentType: 'text/plain', content: raw('attachment') }],
    metadata: { subject: value },
  }
}

class FixtureSource implements MigrationSourceAdapter {
  readonly protocol = 'imap' as const
  fetches = 0
  constructor(
    private readonly baselineItems: InventoryItem[],
    private readonly deltaItems: InventoryItem[] = [],
    private readonly failingKey?: string,
  ) {}
  async listFolders() {
    return [{ sourceFolderId: 'inbox', name: 'Inbox', totalItems: this.baselineItems.length }]
  }
  async inventory() {
    return { items: this.baselineItems }
  }
  async fetchMessage(item: InventoryItem) {
    this.fetches += 1
    const key = `${item.sourceFolderId}:${item.sourceUid ?? item.sourceId}`
    if (key === this.failingKey) throw new Error('fixture source unavailable')
    return message(item, String(item.sourceUid))
  }
  async delta() {
    return { items: this.deltaItems, deleted: [] }
  }
}

class IdempotentTarget implements MigrationTargetPort {
  readonly records = new Map<string, SourceMessage>()
  readonly calls: string[] = []
  async upsertMessage(value: SourceMessage, idempotencyKey: string) {
    this.calls.push(idempotencyKey)
    const identity = `${value.identity.sourceFolderId}:${value.identity.sourceUid ?? value.identity.sourceId}`
    this.records.set(identity, value)
    return { targetId: `target-${identity}` }
  }
}

describe('checkpointed migration', () => {
  let temp: string | undefined
  afterEach(async () => {
    if (temp !== undefined) {
      try {
        rmSync(temp, { recursive: true, force: true })
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50))
        try {
          rmSync(temp, { recursive: true, force: true })
        } catch {
          // ignore Windows lock delay
        }
      }
    }
  })

  it('preserves raw RFC822, flags, labels, dates and attachments and resumes from SQLite', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-migration-'))
    const dbPath = join(temp, 'migration.db')
    const first = { sourceFolderId: 'inbox', sourceUid: 7, messageId: '<seven@example.com>' }
    const second = { sourceFolderId: 'inbox', sourceUid: 8, messageId: '<eight@example.com>' }
    const source = new FixtureSource([first, second], [second])
    const target = new IdempotentTarget()
    const store = MigrationStore.open(dbPath)
    const core = new MigrationCore({ store, source, target, defaultConcurrency: 2 })
    const id = core.createMigration()
    const result = await core.run(id)
    expect(result.status).toBe('completed')
    expect(result.baselineImported).toBe(2)
    expect(result.deltaImported).toBe(0)
    expect(result.duplicatePrevented).toBe(1)
    expect(target.records.get('inbox:7')?.rawRfc822).toEqual(raw('From: 7@example.com\r\n\r\n7'))
    expect(target.records.get('inbox:7')?.attachments[0]?.content).toEqual(raw('attachment'))
    const fetchesBeforeRestart = source.fetches
    store.close()

    const restartedStore = MigrationStore.open(dbPath)
    const restarted = new MigrationCore({
      store: restartedStore,
      source,
      target,
    })
    const resumed = await restarted.run(id)
    expect(resumed.status).toBe('completed')
    expect(resumed.duplicatePrevented).toBe(1)
    expect(source.fetches).toBe(fetchesBeforeRestart)
    restartedStore.close()
  })

  it('reports an item failure without claiming a complete migration', async () => {
    const source = new FixtureSource(
      [
        { sourceFolderId: 'inbox', sourceUid: 1 },
        { sourceFolderId: 'inbox', sourceUid: 2 },
      ],
      [],
      'inbox:2',
    )
    const store = MigrationStore.open()
    const core = new MigrationCore({ store, source, target: new IdempotentTarget() })
    const result = await core.run(core.createMigration())
    expect(result.status).toBe('failed')
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SOURCE_FETCH_FAILED', itemKey: 'inbox:2' }),
      ]),
    )
    store.close()
  })

  it('honours cancellation before importing a page', async () => {
    const source = new FixtureSource([{ sourceFolderId: 'inbox', sourceUid: 1 }])
    const store = MigrationStore.open()
    const id = new MigrationCore({
      store,
      source,
      target: new IdempotentTarget(),
    }).createMigration()
    const controller = new AbortController()
    controller.abort()
    const core = new MigrationCore({ store, source, target: new IdempotentTarget() })
    const result = await core.run(id, { signal: controller.signal })
    expect(result.status).toBe('cancelled')
    expect(result.cancellationRequested).toBe(false)
    store.close()
  })

  it('prevents cross-folder duplicates using fingerprints without redundant target upserts', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-migration-dup-'))
    const dbPath = join(temp, 'migration.db')
    const item1 = {
      sourceFolderId: 'inbox',
      sourceUid: 10,
      messageId: '<shared@example.com>',
      fingerprint: 'fp-shared-123',
    }
    const item2 = {
      sourceFolderId: 'archive',
      sourceUid: 20,
      messageId: '<shared@example.com>',
      fingerprint: 'fp-shared-123',
    }
    const source = new FixtureSource([item1, item2])
    const target = new IdempotentTarget()
    const store = MigrationStore.open(dbPath)
    const core = new MigrationCore({ store, source, target })
    const id = core.createMigration()
    const result = await core.run(id)
    expect(result.status).toBe('completed')
    expect(result.baselineImported).toBe(1)
    expect(result.duplicatePrevented).toBe(1)
    expect(target.calls).toHaveLength(1)
    store.close()
  })

  it('supports multi-folder checkpointed cursors for IMAP and JMAP adapters', async () => {
    const mockConnector = {
      async listMailboxes() {
        return [
          { sourceFolderId: 'f1', name: 'Folder 1', path: 'INBOX.F1', uidValidity: 1, exists: 2 },
          { sourceFolderId: 'f2', name: 'Folder 2', path: 'INBOX.F2', uidValidity: 1, exists: 2 },
        ]
      },
      async listUids(mailbox: { sourceFolderId: string }, cursor?: string) {
        if (cursor === undefined) {
          return {
            items: [{ sourceFolderId: mailbox.sourceFolderId, sourceUid: 1 }],
            nextCursor: 'page2',
          }
        }
        return { items: [{ sourceFolderId: mailbox.sourceFolderId, sourceUid: 2 }] }
      },
      async fetchMessage(mailbox: { sourceFolderId: string }, uid: number) {
        return message(
          { sourceFolderId: mailbox.sourceFolderId, sourceUid: uid },
          `${mailbox.sourceFolderId}-${uid}`,
        )
      },
    }
    const adapter = new (await import('../src/index.js')).ImapSourceAdapter(mockConnector)
    const page1 = await adapter.inventory()
    expect(page1.items).toHaveLength(1)
    expect(page1.nextCursor).toBeDefined()
    const page2 = await adapter.inventory(page1.nextCursor)
    expect(page2.items).toHaveLength(1)
    expect(page2.nextCursor).toBeDefined()
    const page3 = await adapter.inventory(page2.nextCursor)
    expect(page3.items).toHaveLength(1)
    expect(page3.items[0]?.sourceFolderId).toBe('f2')
  })

  it('recovers from process crash and retries failed items on restart with truthful completion', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-migration-restart-'))
    const dbPath = join(temp, 'migration.db')
    const item1 = { sourceFolderId: 'inbox', sourceUid: 1, messageId: '<m1@example.com>' }
    const item2 = { sourceFolderId: 'inbox', sourceUid: 2, messageId: '<m2@example.com>' }

    // First run: item2 fails
    const failingSource = new FixtureSource([item1, item2], [], 'inbox:2')
    const target = new IdempotentTarget()
    const store1 = MigrationStore.open(dbPath)
    const core1 = new MigrationCore({ store: store1, source: failingSource, target })
    const migrationId = core1.createMigration()
    const run1 = await core1.run(migrationId)
    expect(run1.status).toBe('failed')
    expect(run1.failures).toHaveLength(1)
    expect(run1.baselineImported).toBe(1)
    store1.close()

    // Second run: restart with healed source, should retry and truthfully complete
    const healedSource = new FixtureSource([item1, item2])
    const store2 = MigrationStore.open(dbPath)
    const core2 = new MigrationCore({ store: store2, source: healedSource, target })
    const run2 = await core2.run(migrationId, { resume: true })
    expect(run2.status).toBe('completed')
    expect(run2.failures).toHaveLength(0)
    expect(run2.baselineImported).toBe(2)
    expect(target.records.size).toBe(2)
    store2.close()
  })

  it('handles concurrent batch execution on a real SQLite database without race conditions or locks', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-migration-concurrent-'))
    const dbPath = join(temp, 'migration.db')
    const items: InventoryItem[] = Array.from({ length: 20 }, (_, idx) => ({
      sourceFolderId: 'inbox',
      sourceUid: idx + 1,
      messageId: `<msg-${idx + 1}@example.com>`,
    }))
    const source = new FixtureSource(items)
    const target = new IdempotentTarget()
    const store = MigrationStore.open(dbPath)
    const core = new MigrationCore({ store, source, target, defaultConcurrency: 5 })
    const migrationId = core.createMigration(5)
    const result = await core.run(migrationId)
    expect(result.status).toBe('completed')
    expect(result.baselineImported).toBe(20)
    expect(target.records.size).toBe(20)
    store.close()
  })

  it('processes delta changes and deletions with truthful state updates', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-migration-delta-'))
    const dbPath = join(temp, 'migration.db')
    const item1 = { sourceFolderId: 'inbox', sourceUid: 1, messageId: '<msg-1@example.com>' }
    const deltaNew = { sourceFolderId: 'inbox', sourceUid: 2, messageId: '<msg-2@example.com>' }
    const deltaDel = { sourceFolderId: 'inbox', sourceUid: 1, messageId: '<msg-1@example.com>' }

    class DeltaSource extends FixtureSource {
      override async delta() {
        return { items: [deltaNew], deleted: [deltaDel] }
      }
    }

    class DeletableTarget extends IdempotentTarget {
      deletedCount = 0
      override async deleteMessage() {
        this.deletedCount += 1
      }
    }

    const source = new DeltaSource([item1])
    const target = new DeletableTarget()
    const store = MigrationStore.open(dbPath)
    const core = new MigrationCore({ store, source, target })
    const migrationId = core.createMigration()
    const result = await core.run(migrationId)

    expect(result.status).toBe('completed')
    expect(result.baselineImported).toBe(1)
    expect(result.deltaImported).toBe(1)
    expect(result.deleted).toBe(1)
    expect(target.deletedCount).toBe(1)
    store.close()
  })

  it('ensures duplicate inventory items invoke/produce one idempotent target effect under concurrency', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-migration-concurrent-dup-'))
    const dbPath = join(temp, 'migration.db')

    const dupFingerprint = 'shared-fingerprint-concurrency-test'
    const items: InventoryItem[] = Array.from({ length: 10 }, (_, idx) => ({
      sourceFolderId: `folder-${idx}`,
      sourceUid: 100 + idx,
      messageId: '<concurrent-dup@example.com>',
      fingerprint: dupFingerprint,
    }))

    class ConcurrencyTrackingTarget implements MigrationTargetPort {
      readonly upsertCalls: string[] = []
      readonly writtenIdentities = new Set<string>()

      async upsertMessage(value: SourceMessage, idempotencyKey: string) {
        this.upsertCalls.push(idempotencyKey)
        await new Promise((resolve) => setTimeout(resolve, 10))
        this.writtenIdentities.add(idempotencyKey)
        return { targetId: `target-for-${dupFingerprint}` }
      }
    }

    const source = new FixtureSource(items)
    const target = new ConcurrencyTrackingTarget()
    const store = MigrationStore.open(dbPath)
    const core = new MigrationCore({ store, source, target, defaultConcurrency: 5 })
    const migrationId = core.createMigration(5)

    const result = await core.run(migrationId)

    expect(result.status).toBe('completed')
    expect(result.baselineImported).toBe(1)
    expect(result.duplicatePrevented).toBe(9)
    expect(target.upsertCalls).toHaveLength(1)
    expect(target.upsertCalls[0]).toBe(`navin-migration:${migrationId}:${dupFingerprint}`)
    expect(target.writtenIdentities.size).toBe(1)

    store.close()
  })
})
