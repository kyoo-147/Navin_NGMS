import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AccountId,
  FolderId,
  IdempotencyKey,
  MailboxId,
  MessageId,
  ThreadId,
  MailMutationRequest,
  MailMutationResponse,
  MailQueryRequest,
  MailQueryResponse,
  MailSubmissionRequest,
  MailSubmissionResponse,
} from '@navin/contracts'
import type {
  MailGateway,
  MailGatewayContext,
  NormalizedEmail,
  NormalizedMailbox,
  NormalizedChanges,
} from '@navin/mail-gateway'
import { MailStore } from '@navin/mail-store'
import {
  MailClient,
  ContactsManager,
  CalendarManager,
  groupEmailsIntoThreads,
  createReplyDraft,
  sanitizeHtml,
  evaluateServerCapabilities,
  getCapabilityNotices,
} from '../src/index.js'

describe('End-to-End Loopback JMAP & Multi-Account SQLite Restart Test', () => {
  let tempDir: string
  let aliceDbPath: string
  let bobDbPath: string

  // Server-side loopback message and mailbox store
  let serverEmails: Map<string, NormalizedEmail>
  let serverMailboxes: Map<string, NormalizedMailbox[]>
  let submissionHistory: Array<{ accountId: string; req: MailSubmissionRequest }>
  let mutationHistory: Array<{ accountId: string; req: MailMutationRequest }>
  let recipientByMessage: Map<string, string>
  let senderByMessage: Map<string, string>

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'navin-e2e-'))
    aliceDbPath = join(tempDir, 'alice-store.db')
    bobDbPath = join(tempDir, 'bob-store.db')

    serverEmails = new Map()
    serverMailboxes = new Map()
    submissionHistory = []
    mutationHistory = []
    recipientByMessage = new Map()
    senderByMessage = new Map()

    // Seed server mailboxes
    serverMailboxes.set('acc-alice', [
      {
        id: 'mb-alice-inbox' as MailboxId,
        folderId: 'fld-a-inbox' as FolderId,
        name: 'Inbox',
        parentId: null,
        role: 'inbox',
        rawRole: 'inbox',
        sortOrder: 1,
        totalEmails: 0,
        unreadEmails: 0,
        totalThreads: 0,
        unreadThreads: 0,
        isSubscribed: true,
        rights: {
          mayReadItems: true,
          mayAddItems: true,
          mayRemoveItems: true,
          maySetSeen: true,
          maySetKeywords: true,
          mayCreateChild: true,
          mayRename: true,
          mayDelete: true,
          maySubmit: true,
        },
      },
      {
        id: 'mb-alice-sent' as MailboxId,
        folderId: 'fld-a-sent' as FolderId,
        name: 'Sent',
        parentId: null,
        role: 'sent',
        rawRole: 'sent',
        sortOrder: 2,
        totalEmails: 0,
        unreadEmails: 0,
        totalThreads: 0,
        unreadThreads: 0,
        isSubscribed: true,
        rights: {
          mayReadItems: true,
          mayAddItems: true,
          mayRemoveItems: true,
          maySetSeen: true,
          maySetKeywords: true,
          mayCreateChild: true,
          mayRename: true,
          mayDelete: true,
          maySubmit: true,
        },
      },
    ])

    serverMailboxes.set('acc-bob', [
      {
        id: 'mb-bob-inbox' as MailboxId,
        folderId: 'fld-b-inbox' as FolderId,
        name: 'Inbox',
        parentId: null,
        role: 'inbox',
        rawRole: 'inbox',
        sortOrder: 1,
        totalEmails: 0,
        unreadEmails: 0,
        totalThreads: 0,
        unreadThreads: 0,
        isSubscribed: true,
        rights: {
          mayReadItems: true,
          mayAddItems: true,
          mayRemoveItems: true,
          maySetSeen: true,
          maySetKeywords: true,
          mayCreateChild: true,
          mayRename: true,
          mayDelete: true,
          maySubmit: true,
        },
      },
      {
        id: 'mb-bob-sent' as MailboxId,
        folderId: 'fld-b-sent' as FolderId,
        name: 'Sent',
        parentId: null,
        role: 'sent',
        rawRole: 'sent',
        sortOrder: 2,
        totalEmails: 0,
        unreadEmails: 0,
        totalThreads: 0,
        unreadThreads: 0,
        isSubscribed: true,
        rights: {
          mayReadItems: true,
          mayAddItems: true,
          mayRemoveItems: true,
          maySetSeen: true,
          maySetKeywords: true,
          mayCreateChild: true,
          mayRename: true,
          mayDelete: true,
          maySubmit: true,
        },
      },
    ])
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  /**
   * Creates a loopback gateway that routes email submissions between accounts
   * and tracks mutation/submission idempotency.
   */
  function createLoopbackGateway(): MailGateway & {
    getCapabilities(): Promise<Record<string, unknown>>
  } {
    return {
      async listAccounts() {
        return [
          { id: 'acc-alice', username: 'alice@example.com', isPrimary: true, isReadOnly: false },
          { id: 'acc-bob', username: 'bob@example.com', isPrimary: false, isReadOnly: false },
        ]
      },
      async listMailboxes(ctx: MailGatewayContext) {
        return serverMailboxes.get(ctx.sessionId) || []
      },
      async getEmails(_ctx: MailGatewayContext, ids: MessageId[]) {
        const result: NormalizedEmail[] = []
        for (const id of ids) {
          const email = serverEmails.get(id)
          if (email) result.push(email)
        }
        return result
      },
      async getEmailChanges(ctx: MailGatewayContext, sinceState: string) {
        return {
          kind: 'email',
          accountId: ctx.sessionId as AccountId,
          oldState: sinceState,
          newState: 'state-latest',
          hasMoreChanges: false,
          created: [],
          updated: [],
          destroyed: [],
        } as NormalizedChanges
      },
      async queryMail(ctx: MailGatewayContext, _req: MailQueryRequest): Promise<MailQueryResponse> {
        const accountEmails = Array.from(serverEmails.values()).filter(
          (message) =>
            recipientByMessage.get(message.id) === ctx.sessionId ||
            senderByMessage.get(message.id) === ctx.sessionId,
        )
        return {
          accountId: ctx.sessionId as AccountId,
          threadIds: [...new Set(accountEmails.map((message) => message.threadId))],
          messageIds: accountEmails.map((m) => m.id),
          total: accountEmails.length,
          position: 0,
          canCalculateChanges: true,
          queryState: 'query-state-latest',
        }
      },
      async getEmail(_ctx: MailGatewayContext, _accountId: string, emailId: MessageId) {
        return serverEmails.get(emailId)
      },
      async getThread(_ctx: MailGatewayContext, _accountId: string, threadId: ThreadId) {
        const msgs = Array.from(serverEmails.values()).filter((m) => m.threadId === threadId)
        return { id: threadId, messageIds: msgs.map((m) => m.id) }
      },
      async mutate(
        ctx: MailGatewayContext,
        req: MailMutationRequest,
      ): Promise<MailMutationResponse> {
        mutationHistory.push({ accountId: ctx.sessionId, req })
        for (const targetId of req.targetIds) {
          const email = serverEmails.get(targetId as MessageId)
          if (email && req.mutation === 'mark_read') email.isUnread = false
          if (email && req.mutation === 'mark_unread') email.isUnread = true
          if (email && req.mutation === 'star') email.isStarred = true
          if (email && req.mutation === 'unstar') email.isStarred = false
        }
        return {
          success: true,
          idempotencyKey: req.idempotencyKey,
          affectedCount: req.targetIds.length,
          newState: `mutation-state-${mutationHistory.length}`,
        }
      },
      async submit(
        ctx: MailGatewayContext,
        req: MailSubmissionRequest,
      ): Promise<MailSubmissionResponse> {
        // Idempotency check: if already submitted with this idempotency key, return existing
        const existing = submissionHistory.find((s) => s.req.idempotencyKey === req.idempotencyKey)
        if (existing) {
          return {
            submissionId: `sub-${req.idempotencyKey}`,
            idempotencyKey: req.idempotencyKey,
            messageId: `msg-${req.idempotencyKey}` as MessageId,
            status: 'sent',
            submittedAt: new Date().toISOString(),
          }
        }

        submissionHistory.push({ accountId: ctx.sessionId, req })

        // Create the email in server store
        const messageId = `msg-delivered-${Date.now()}-${submissionHistory.length}` as MessageId
        const refId = req.references?.[0]
        const parentEmail = refId ? serverEmails.get(refId as MessageId) : undefined
        const threadId = (parentEmail ? parentEmail.threadId : `th-${messageId}`) as ThreadId

        // Route to recipient
        const recipientEmail = req.to[0]?.address ?? 'bob@example.com'
        const recipientAccount = recipientEmail.includes('bob') ? 'acc-bob' : 'acc-alice'
        const recipientMailbox = recipientAccount === 'acc-bob' ? 'mb-bob-inbox' : 'mb-alice-inbox'

        const deliveredEmail: NormalizedEmail = {
          id: messageId,
          threadId,
          mailboxIds: [recipientMailbox as MailboxId],
          keywords: [],
          isUnread: true,
          isStarred: false,
          isDraft: false,
          isAnswered: false,
          hasAttachment: (req.attachments?.length ?? 0) > 0,
          size: 2048,
          preview: (req.bodyText ?? '').slice(0, 50),
          subject: req.subject,
          from: [req.from],
          to: req.to,
          cc: req.cc ?? [],
          bcc: req.bcc ?? [],
          replyTo: [],
          sentAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
          bodyText: req.bodyText ?? null,
          bodyHtml: req.bodyHtml ?? null,
          attachments: req.attachments ?? [],
          messageId: [`<${messageId}@example.com>`],
          inReplyTo: req.inReplyTo ? [req.inReplyTo] : null,
          references: req.references ?? null,
        }

        serverEmails.set(messageId, deliveredEmail)
        recipientByMessage.set(messageId, recipientAccount)
        senderByMessage.set(messageId, ctx.sessionId)

        return {
          submissionId: `sub-${req.idempotencyKey}`,
          idempotencyKey: req.idempotencyKey,
          messageId,
          status: 'sent',
          submittedAt: new Date().toISOString(),
        }
      },
      async undoMutation(_ctx: MailGatewayContext, _undoToken: string) {
        return { undone: true }
      },
      async getCapabilities() {
        return {
          'urn:ietf:params:jmap:core': {},
          'urn:ietf:params:jmap:mail': {},
          'urn:ietf:params:jmap:submission': {},
        }
      },
    } as unknown as MailGateway & {
      getCapabilities(): Promise<Record<string, unknown>>
    }
  }

  it('handles multi-account communication, offline queueing, SQLite restart, and duplicate-free replay', async () => {
    const loopbackGateway = createLoopbackGateway()

    // 1. Initialize Alice and Bob local stores and clients
    let aliceStore = new MailStore({ path: aliceDbPath })
    let bobStore = new MailStore({ path: bobDbPath })

    let aliceClient = new MailClient({
      gateway: loopbackGateway,
      store: aliceStore,
      ctxFactory: (accId) => ({ sessionId: accId }),
      autoReconcile: false,
    })

    let bobClient = new MailClient({
      gateway: loopbackGateway,
      store: bobStore,
      ctxFactory: (accId) => ({ sessionId: accId }),
      autoReconcile: false,
    })

    // Setup initial store accounts and mailboxes
    aliceStore.putAccount('acc-alice', 'alice@example.com', '0')
    bobStore.putAccount('acc-bob', 'bob@example.com', '0')

    // 2. Alice sends an email to Bob while online
    const aliceDraft = {
      id: 'draft-alice-1',
      accountId: 'acc-alice',
      senderIdentityId: 'alice@example.com',
      to: [{ name: 'Bob Jones', address: 'bob@example.com' }],
      cc: [],
      bcc: [],
      subject: 'Phase 1 Functional Delivery',
      bodyText: 'Hi Bob, please review the attached architecture blueprint.',
      bodyHtml:
        '<p>Hi Bob, please review the attached architecture blueprint.</p><img src="http://192.0.2.10/tracker.png" /><script>alert(1)</script>',
      attachments: [
        {
          blobId: 'blob-blueprint-1',
          filename: 'navin-arch.pdf',
          mimeType: 'application/pdf',
          size: 1024 * 50,
        },
      ],
      references: [],
      updatedAt: new Date().toISOString(),
      status: 'draft' as const,
    }

    const sendRes = await aliceClient.submitDraft(aliceDraft, {
      fromAddress: { name: 'Alice Smith', address: 'alice@example.com' },
      undoDelaySeconds: 0,
    })

    expect(sendRes.status).toBe('sent')
    expect(submissionHistory).toHaveLength(1)
    expect(serverEmails.size).toBe(1)

    // 3. Bob goes online, fetches emails, and caches the message from Alice
    const bobQuery = await bobClient.queryThreads('acc-bob', {
      accountId: 'acc-bob' as AccountId,
      position: 0,
      limit: 100,
    })
    expect(bobQuery.threads).toHaveLength(1)
    const bobThread = bobQuery.threads[0]!
    const bobReceived = bobThread.messages[0]!
    expect(bobReceived.subject).toBe('Phase 1 Functional Delivery')
    expect(bobReceived.from[0]?.address).toBe('alice@example.com')
    expect(bobReceived.hasAttachment).toBe(true)

    // Verify HTML Sanitizer on received email
    const sanitized = sanitizeHtml(bobReceived.bodyHtml || '', {
      allowRemoteImages: false,
    })
    expect(sanitized.sanitizedHtml).not.toContain('<script>')
    expect(sanitized.sanitizedHtml).not.toContain('192.0.2.10')
    expect(sanitized.blockedRemoteImagesCount).toBe(1)

    // 4. Bob goes OFFLINE
    bobClient.setOnline(false)
    expect(bobClient.isOnline()).toBe(false)

    // Bob marks email as read while offline
    const mutRes = await bobClient.mutate('acc-bob', {
      mutation: 'mark_read',
      targetIds: [bobReceived.id],
      idempotencyKey: 'idemp-bob-mut-1' as IdempotencyKey,
    })
    expect(mutRes.newState).toBe('offline-queued')

    // Bob composes and submits a reply draft to Alice while offline
    const replyDraft = createReplyDraft(
      bobReceived,
      'acc-bob',
      { name: 'Bob Jones', address: 'bob@example.com' },
      false,
    )
    replyDraft.bodyText = 'Hi Alice, looks fantastic! Ready to merge.'
    replyDraft.attachments = [
      {
        blobId: 'blob-bob-signoff',
        filename: 'signoff.pdf',
        mimeType: 'application/pdf',
        size: 2048,
      },
    ]

    const replySubmitRes = await bobClient.submitDraft(replyDraft, {
      fromAddress: { name: 'Bob Jones', address: 'bob@example.com' },
      undoDelaySeconds: 0,
    })
    expect(replySubmitRes.status).toBe('queued')

    // Verify Bob's outbox contains the mutation and submission items
    const outboxPendingBeforeRestart = bobStore.listOutbox('acc-bob')
    expect(outboxPendingBeforeRestart).toHaveLength(2)
    expect(outboxPendingBeforeRestart[0]?.kind).toBe('mutation')
    expect(outboxPendingBeforeRestart[1]?.kind).toBe('submission')
    expect(outboxPendingBeforeRestart[0]?.status).toBe('pending')
    expect(outboxPendingBeforeRestart[1]?.status).toBe('pending')

    // Server submission count must still be 1 (Bob's reply has NOT hit the server yet)
    expect(submissionHistory).toHaveLength(1)

    // 5. SIMULATE FULL PROCESS RESTART / CRASH RESILIENCE
    // Close Bob's SQLite connection and discard the in-memory client
    bobStore.close()

    // Reopen brand new MailStore pointing to the EXACT same SQLite database file on disk
    bobStore = new MailStore({ path: bobDbPath })
    const outboxAfterRestart = bobStore.listOutbox('acc-bob')

    // Verify all outbox items survived the SQLite restart completely intact
    expect(outboxAfterRestart).toHaveLength(2)
    expect(outboxAfterRestart[0]?.idempotencyKey).toBe('idemp-bob-mut-1')
    expect(outboxAfterRestart[1]?.kind).toBe('submission')
    expect(outboxAfterRestart[1]?.status).toBe('pending')

    // Recreate Bob's client with the restarted store
    bobClient = new MailClient({
      gateway: loopbackGateway,
      store: bobStore,
      ctxFactory: (accId) => ({ sessionId: accId }),
      autoReconcile: false,
    })

    // 6. Bob RECONNECTS ONLINE
    bobClient.setOnline(true)
    expect(bobClient.isOnline()).toBe(true)

    // Run reconciliation to replay queued outbox
    const reconcileStats = await bobClient.reconcileAll()
    expect(reconcileStats.sent).toBe(2)
    expect(reconcileStats.conflicts).toHaveLength(0)

    // Server now has Bob's mutation and reply submission
    expect(mutationHistory).toHaveLength(1)
    expect(submissionHistory).toHaveLength(2)
    expect(serverEmails.size).toBe(2)

    // Bob's outbox items should now be marked as 'sent'
    const outboxAfterReconcile = bobStore.listOutbox('acc-bob')
    expect(outboxAfterReconcile.every((item) => item.status === 'sent')).toBe(true)

    // 7. Verify NO DUPLICATE SENDS upon subsequent syncs (idempotency enforcement)
    const secondSyncStats = await bobClient.reconcileAll()
    expect(secondSyncStats.sent).toBe(0) // No pending items replayed
    expect(submissionHistory).toHaveLength(2) // Zero duplicate submissions to gateway!

    // 8. Alice fetches new messages and verifies threading
    const aliceQuery = await aliceClient.queryThreads('acc-alice', {
      accountId: 'acc-alice' as AccountId,
      position: 0,
      limit: 100,
    })
    expect(aliceQuery.threads.length).toBeGreaterThanOrEqual(1)

    const allDeliveredEmails = Array.from(serverEmails.values())
    const threads = groupEmailsIntoThreads(allDeliveredEmails)
    expect(threads).toHaveLength(1)
    expect(threads[0]?.messageCount).toBe(2)
    expect(threads[0]?.participants).toHaveLength(2)
    expect(threads[0]?.participants.map((p) => p.address)).toEqual(
      expect.arrayContaining(['alice@example.com', 'bob@example.com']),
    )

    // 9. Contacts and Calendar Integration
    const contactsMgr = new ContactsManager()
    const bobContact = contactsMgr.createContact('acc-alice', {
      name: 'Bob Jones',
      email: 'bob@example.com',
      company: 'Navin Partner',
      groups: ['engineering'],
    })
    expect(bobContact.id).toBeDefined()
    expect(contactsMgr.listContacts('acc-alice')).toHaveLength(1)

    // Export vCard & re-import
    const vCard = contactsMgr.exportVCard(bobContact.accountId)
    expect(vCard).toContain('FN:Bob Jones')
    expect(vCard).toContain('EMAIL:bob@example.com')

    const calMgr = new CalendarManager()
    const sprintReview = calMgr.createEvent('acc-alice', {
      title: 'Phase 1 Sprint Review',
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      allDay: false,
      location: 'Main Hall',
      attendees: [
        { name: 'Alice Smith', email: 'alice@example.com', rsvpStatus: 'accepted' },
        { name: 'Bob Jones', email: 'bob@example.com', rsvpStatus: 'needs-action' },
      ],
      myRsvpStatus: 'accepted',
    })
    expect(sprintReview.id).toBeDefined()

    // Bob accepts RSVP
    const updatedEvt = calMgr.setRsvp(sprintReview.id, 'bob@example.com', 'accepted')
    expect(updatedEvt?.myRsvpStatus).toBe('accepted')

    // 10. Explicit unsupported capabilities inspection
    const caps = evaluateServerCapabilities(await loopbackGateway.getCapabilities())
    const notices = getCapabilityNotices(caps)
    const unsupported = notices.filter((n) => !n.supported)
    expect(unsupported.map((u) => u.capability)).toEqual(
      expect.arrayContaining(['scheduledSend', 'snooze', 'serverFilters']),
    )

    aliceStore.close()
    bobStore.close()
  })
})
