import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { MailStore } from '../src/store.js'
import { OutboxReconciler } from '../src/reconciler.js'
import type { MailGateway, NormalizedEmail, NormalizedMailbox } from '@navin/mail-gateway'
import type {
  FolderId,
  MailMutationRequest,
  MailboxId,
  MailSubmissionRequest,
  MessageId,
  ThreadId,
} from '@navin/contracts'

describe('MailStore & OutboxReconciler', () => {
  let tempDir: string
  let dbPath: string
  let store: MailStore

  const sampleMailbox: NormalizedMailbox = {
    id: 'mb-inbox' as MailboxId,
    folderId: 'folder-inbox' as FolderId,
    name: 'Inbox',
    parentId: null,
    role: 'inbox',
    rawRole: 'inbox',
    sortOrder: 1,
    totalEmails: 10,
    unreadEmails: 2,
    totalThreads: 8,
    unreadThreads: 2,
    isSubscribed: true,
    rights: {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      mayCreateChild: false,
      mayRename: false,
      mayDelete: false,
      maySubmit: true,
    },
  }

  const sampleEmail = (id: string, threadId: string = 'th-1'): NormalizedEmail => ({
    id: id as MessageId,
    threadId: threadId as ThreadId,
    mailboxIds: ['mb-inbox' as MailboxId],
    keywords: [],
    from: [{ name: 'Alice Example', address: 'alice@example.com' }],
    to: [{ name: 'Bob Test', address: 'bob@company.test' }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: `Test message ${id}`,
    receivedAt: '2026-10-01T12:00:00.000Z',
    sentAt: '2026-10-01T11:59:00.000Z',
    size: 1024,
    preview: `Preview of message ${id}`,
    bodyText: `Body text for message ${id}`,
    bodyHtml: `<p>Body text for message ${id}</p>`,
    hasAttachment: false,
    attachments: [],
    isUnread: true,
    isStarred: false,
    isDraft: false,
    isAnswered: false,
    messageId: [`<${id}@example.com>`],
    inReplyTo: null,
    references: null,
  })

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mail-store-test-'))
    dbPath = join(tempDir, 'mail.sqlite')
    store = new MailStore({ path: dbPath })
  })

  afterEach(() => {
    try {
      store.close()
    } catch {
      // already closed
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('stores and retrieves accounts and mailboxes', () => {
    store.putAccount('acc-1', 'alice@example.com', 'state-1')
    const account = store.getAccount('acc-1')
    expect(account).not.toBeNull()
    expect(account?.username).toBe('alice@example.com')
    expect(account?.state).toBe('state-1')

    store.putMailboxes('acc-1', [sampleMailbox])
    const mailboxes = store.listMailboxes('acc-1')
    expect(mailboxes).toHaveLength(1)
    expect(mailboxes[0]?.id).toBe('mb-inbox')
    expect(mailboxes[0]?.name).toBe('Inbox')
  })

  it('stores, retrieves, and updates messages and threads', () => {
    const msg1 = sampleEmail('msg-1', 'th-1')
    const msg2 = sampleEmail('msg-2', 'th-1')
    store.putMessages('acc-1', [msg1, msg2])

    const retrieved = store.getMessage('acc-1', 'msg-1' as MessageId)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.subject).toBe('Test message msg-1')
    expect(retrieved?.accountId).toBe('acc-1')

    const thread = store.getThread('acc-1', 'th-1' as ThreadId)
    expect(thread).toHaveLength(2)
    expect(thread.map((m) => m.id)).toEqual(['msg-1', 'msg-2'])

    const queryRes = store.queryCachedMessages('acc-1', { inMailbox: 'mb-inbox', isUnread: true })
    expect(queryRes).toHaveLength(2)
  })

  it('enforces bounded cache quota by evicting LRU messages', () => {
    let tick = 1000
    const monotonicNow = () => new Date(tick++ * 1000).toISOString()
    const boundedStore = new MailStore({
      path: join(tempDir, 'bounded.sqlite'),
      quotaBytes: 1500,
      now: monotonicNow,
    })

    try {
      const msg1 = sampleEmail('msg-1')
      const msg2 = sampleEmail('msg-2')
      const msg3 = sampleEmail('msg-3')

      boundedStore.putMessage(msg1, 'acc-1')
      boundedStore.putMessage(msg2, 'acc-1')

      // Touch msg1 so msg2 becomes oldest accessed
      boundedStore.getMessage('acc-1', 'msg-1' as MessageId)

      // Put msg3 which should push usage over quota and evict msg2
      boundedStore.putMessage(msg3, 'acc-1')

      expect(boundedStore.getMessage('acc-1', 'msg-3' as MessageId)).not.toBeNull()
      expect(boundedStore.getMessage('acc-1', 'msg-1' as MessageId)).not.toBeNull()
      expect(boundedStore.getMessage('acc-1', 'msg-2' as MessageId)).toBeNull()
    } finally {
      boundedStore.close()
    }
  })

  it('encrypts message bodies at rest when key is provided', () => {
    const key = randomBytes(32)
    const encStore = new MailStore({
      path: join(tempDir, 'encrypted.sqlite'),
      encryptionKey: key,
    })

    const msg = sampleEmail('msg-enc')
    encStore.putMessage(msg, 'acc-1')

    // Read back via encrypted store
    const readBack = encStore.getMessage('acc-1', 'msg-enc' as MessageId)
    expect(readBack?.subject).toBe('Test message msg-enc')
    expect(readBack?.bodyText).toBe('Body text for message msg-enc')
    encStore.close()

    // Open without key - reading should throw when decoding encrypted payload
    const plainStore = new MailStore({
      path: join(tempDir, 'encrypted.sqlite'),
    })
    expect(() => plainStore.getMessage('acc-1', 'msg-enc' as MessageId)).toThrow(
      'Encrypted mail payload requires an encryption key',
    )
    plainStore.close()
  })

  it('guarantees durable idempotency: re-enqueuing returns existing outbox record without duplicate insert', () => {
    const item1 = store.enqueue({
      id: 'out-1',
      accountId: 'acc-1',
      kind: 'submission',
      idempotencyKey: 'idem-key-1',
      payload: { subject: 'Hello world' },
      dependencyId: null,
    })
    expect(item1.status).toBe('pending')

    // Re-enqueue the same operation with the same key but a different local ID.
    const duplicate = store.enqueue({
      id: 'out-2-different',
      accountId: 'acc-1',
      kind: 'submission',
      idempotencyKey: 'idem-key-1',
      payload: { subject: 'Hello world' },
      dependencyId: null,
    })

    // Must return the original item without inserting a second row
    expect(duplicate.id).toBe('out-1')
    expect(duplicate.idempotencyKey).toBe('idem-key-1')

    const outbox = store.listOutbox('acc-1')
    expect(outbox).toHaveLength(1)
    expect(outbox[0]?.id).toBe('out-1')
  })

  it('refuses to reuse an idempotency key for a different operation', () => {
    store.enqueue({
      id: 'out-binding-1',
      accountId: 'acc-1',
      kind: 'mutation',
      idempotencyKey: 'idem-bound',
      payload: { mutation: 'archive', targetIds: ['msg-1'] },
      dependencyId: null,
    })

    expect(() =>
      store.enqueue({
        id: 'out-binding-2',
        accountId: 'acc-1',
        kind: 'mutation',
        idempotencyKey: 'idem-bound',
        payload: { mutation: 'delete', targetIds: ['msg-1'] },
        dependencyId: null,
      }),
    ).toThrow(/already bound/i)
    expect(store.listOutbox('acc-1')).toHaveLength(1)
  })

  it('survives complete process restart without data or outbox loss', () => {
    store.putAccount('acc-1', 'alice@example.com', 'state-start')
    store.putMailboxes('acc-1', [sampleMailbox])
    store.putMessage(sampleEmail('msg-restart'), 'acc-1')
    store.upsertDraft({
      id: 'draft-1',
      accountId: 'acc-1',
      senderIdentityId: 'user-1',
      to: [{ address: 'bob@company.test' }],
      cc: [],
      bcc: [],
      subject: 'Draft to survive restart',
      bodyText: 'Draft text',
      bodyHtml: '<p>Draft text</p>',
      attachments: [],
      references: [],
      status: 'draft',
      updatedAt: '2026-10-01T12:00:00.000Z',
    })

    store.enqueue({
      id: 'out-first',
      accountId: 'acc-1',
      kind: 'mutation',
      idempotencyKey: 'idem-restart-1',
      payload: { mutation: 'mark_read', targetIds: ['msg-restart'] },
      dependencyId: null,
    })
    store.enqueue({
      id: 'out-second',
      accountId: 'acc-1',
      kind: 'submission',
      idempotencyKey: 'idem-restart-2',
      payload: { subject: 'Second dependent mail' },
      dependencyId: 'out-first',
    })
    store.setSyncState('acc-1', 'sync-state-v1')

    // CLOSE database
    store.close()

    // REOPEN database with new instance on same path
    const reopenedStore = new MailStore({ path: dbPath })

    expect(reopenedStore.getAccount('acc-1')?.username).toBe('alice@example.com')
    expect(reopenedStore.listMailboxes('acc-1')).toHaveLength(1)
    expect(reopenedStore.getMessage('acc-1', 'msg-restart' as MessageId)?.subject).toBe(
      'Test message msg-restart',
    )
    expect(reopenedStore.getDraft('draft-1')?.subject).toBe('Draft to survive restart')
    expect(reopenedStore.getSyncState('acc-1')).toBe('sync-state-v1')

    const outbox = reopenedStore.listOutbox('acc-1')
    expect(outbox).toHaveLength(2)
    expect(outbox[0]?.id).toBe('out-first')
    expect(outbox[1]?.id).toBe('out-second')
    expect(outbox[1]?.dependencyId).toBe('out-first')

    reopenedStore.close()
  })

  it('recovers interrupted processing for idempotent replay after restart', () => {
    store.enqueue({
      id: 'out-interrupted',
      accountId: 'acc-1',
      kind: 'mutation',
      idempotencyKey: 'idem-interrupted',
      payload: { mutation: 'archive', targetIds: ['msg-1'] },
      dependencyId: null,
    })
    expect(store.markOutboxProcessing('out-interrupted')).toBe(true)
    store.close()

    const reopenedStore = new MailStore({ path: dbPath })
    expect(reopenedStore.listOutbox('acc-1')[0]?.status).toBe('pending')
    expect(reopenedStore.listOutbox('acc-1')[0]?.idempotencyKey).toBe('idem-interrupted')
    reopenedStore.close()
  })

  it('reconciles outbox in strict dependency order and never sends duplicates', async () => {
    store.enqueue({
      id: 'task-1',
      accountId: 'acc-1',
      kind: 'mutation',
      idempotencyKey: 'idem-order-1',
      payload: { mutation: 'archive', targetIds: ['msg-1'] },
      dependencyId: null,
    })

    store.enqueue({
      id: 'task-2',
      accountId: 'acc-1',
      kind: 'submission',
      idempotencyKey: 'idem-order-2',
      payload: { subject: 'Reply to msg-1' },
      dependencyId: 'task-1',
    })

    const executedCalls: string[] = []

    const mockGateway = {
      mutate: async (_ctx: unknown, req: MailMutationRequest) => {
        executedCalls.push(`mutate:${req.mutation}`)
        return {
          success: true,
          idempotencyKey: 'idem-order-1',
          affectedCount: 1,
          newState: 'state-2',
        }
      },
      submit: async (_ctx: unknown, req: MailSubmissionRequest) => {
        executedCalls.push(`submit:${req.subject}`)
        return {
          submissionId: 'sub-1',
          idempotencyKey: 'idem-order-2',
          messageId: 'msg-new' as MessageId,
          status: 'sent',
          submittedAt: '2026-10-01T12:00:00.000Z',
        }
      },
    } as unknown as MailGateway

    const reconciler = new OutboxReconciler({
      store,
      gateway: mockGateway,
      ctxFactory: (accId) => ({ sessionId: `session-${accId}` }),
    })

    const result = await reconciler.reconcileOutbox('acc-1')
    expect(result.sent).toBe(2)
    expect(result.failed).toBe(0)
    expect(executedCalls).toEqual(['mutate:archive', 'submit:Reply to msg-1'])

    // Running reconcile a second time must do 0 sends because items are already 'sent'
    const secondResult = await reconciler.reconcileOutbox('acc-1')
    expect(secondResult.processed).toBe(0)
    expect(secondResult.sent).toBe(0)
    expect(executedCalls).toHaveLength(2)
  })

  it('records conflict and transitions to needs_attention when submission fails', async () => {
    store.enqueue({
      id: 'bad-submission',
      accountId: 'acc-1',
      kind: 'submission',
      idempotencyKey: 'idem-fail-1',
      payload: { subject: 'Rejected by policy' },
      dependencyId: null,
    })

    const mockGateway = {
      submit: async () => {
        throw new Error('Sender identity not permitted')
      },
    } as unknown as MailGateway

    let notifiedConflict = false
    const reconciler = new OutboxReconciler({
      store,
      gateway: mockGateway,
      ctxFactory: (accId) => ({ sessionId: `session-${accId}` }),
      onConflict: () => {
        notifiedConflict = true
      },
    })

    const result = await reconciler.reconcileOutbox('acc-1')
    expect(result.failed).toBe(1)
    expect(notifiedConflict).toBe(true)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.reason).toBe('submission_failed')
    expect(result.conflicts[0]?.detail).toContain('Sender identity not permitted')

    const outbox = store.listOutbox('acc-1')
    expect(outbox[0]?.status).toBe('needs_attention')
    expect(outbox[0]?.lastError).toContain('Sender identity not permitted')

    const conflicts = store.listConflicts('acc-1')
    expect(conflicts).toHaveLength(1)
  })
})
