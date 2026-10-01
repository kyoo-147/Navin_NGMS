import { describe, it, expect, vi } from 'vitest'
import { groupEmailsIntoThreads } from '../src/thread/threader.js'
import {
  createNewDraft,
  createReplyDraft,
  createForwardDraft,
  detectMissingAttachmentWarning,
  validateDraftRecipients,
} from '../src/draft/draft-manager.js'
import { buildSubmissionRequest, UndoSendManager } from '../src/submission/submission-handler.js'
import type { NormalizedEmail } from '@navin/mail-gateway'
import type { IdempotencyKey, MailboxId, MessageId, ThreadId } from '@navin/contracts'

describe('Threads, Drafts, and Submissions', () => {
  const email1: NormalizedEmail = {
    id: 'msg-1' as MessageId,
    threadId: 'th-1' as ThreadId,
    mailboxIds: ['mb-inbox' as MailboxId],
    keywords: [],
    isUnread: true,
    isStarred: false,
    isDraft: false,
    isAnswered: false,
    hasAttachment: false,
    size: 200,
    preview: 'First message',
    subject: 'Project Kickoff',
    from: [{ name: 'Alice', address: 'alice@example.com' }],
    to: [{ name: 'Bob', address: 'bob@example.com' }],
    cc: [],
    bcc: [],
    replyTo: [],
    sentAt: '2026-10-01T09:00:00.000Z',
    receivedAt: '2026-10-01T09:00:01.000Z',
    bodyText: 'First message content',
    bodyHtml: '<p>First message content</p>',
    attachments: [],
    messageId: ['<msg-1@example.invalid>'],
    inReplyTo: null,
    references: null,
  }

  const email2: NormalizedEmail = {
    id: 'msg-2' as MessageId,
    threadId: 'th-1' as ThreadId,
    mailboxIds: ['mb-inbox' as MailboxId],
    keywords: [],
    isUnread: false,
    isStarred: true,
    hasAttachment: true,
    isDraft: false,
    isAnswered: true,
    size: 500,
    preview: 'Second message reply',
    subject: 'Re: Project Kickoff',
    from: [{ name: 'Bob', address: 'bob@example.com' }],
    to: [{ name: 'Alice', address: 'alice@example.com' }],
    cc: [{ name: 'Carol', address: 'carol@example.com' }],
    bcc: [],
    replyTo: [],
    sentAt: '2026-10-01T09:30:00.000Z',
    receivedAt: '2026-10-01T09:30:01.000Z',
    bodyText: 'Second message reply text',
    bodyHtml: '<p>Second message reply text</p>',
    attachments: [{ filename: 'spec.pdf', mimeType: 'application/pdf', size: 1024 }],
    messageId: ['<msg-2@example.invalid>'],
    inReplyTo: ['<msg-1@example.invalid>'],
    references: ['<msg-1@example.invalid>'],
  }

  it('groups emails into threads with aggregated metadata', () => {
    const threads = groupEmailsIntoThreads([email1, email2])
    expect(threads).toHaveLength(1)
    const t = threads[0]!
    expect(t.id).toBe('th-1')
    expect(t.messageCount).toBe(2)
    expect(t.unreadCount).toBe(1)
    expect(t.isStarred).toBe(true)
    expect(t.hasAttachment).toBe(true)
    expect(t.participants.map((p) => p.address)).toEqual(['alice@example.com', 'bob@example.com'])
    expect(t.latestReceivedAt).toBe('2026-10-01T09:30:01.000Z')
    expect(t.snippet).toBe('Second message reply')
  })

  it('creates reply and forward drafts with correct headers and quotes', () => {
    const replyDraft = createReplyDraft(email1, 'acc-1', { address: 'bob@example.com' }, false)
    expect(replyDraft.to[0]?.address).toBe('alice@example.com')
    expect(replyDraft.subject).toBe('Re: Project Kickoff')
    expect(replyDraft.inReplyTo).toBe('msg-1')
    expect(replyDraft.references).toEqual(['msg-1'])
    expect(replyDraft.bodyHtml).toContain('Alice')

    const forwardDraft = createForwardDraft(email2, 'acc-1', { address: 'alice@example.com' })
    expect(forwardDraft.subject).toBe('Fwd: Re: Project Kickoff')
    expect(forwardDraft.attachments).toHaveLength(1)
    expect(forwardDraft.attachments[0]?.filename).toBe('spec.pdf')
  })

  it('validates recipients and detects missing attachments', () => {
    const draft = createNewDraft('acc-1', 'user-1', {
      to: [],
      subject: 'Review attached document',
      bodyText: 'Please see attached contract.',
    })

    const validation = validateDraftRecipients(draft)
    expect(validation.valid).toBe(false)
    expect(validation.errors[0]).toContain('At least one recipient')

    const missingAtt = detectMissingAttachmentWarning(draft)
    expect(missingAtt).toBe(true)

    // With attachment added
    draft.attachments.push({ filename: 'contract.pdf', mimeType: 'application/pdf', size: 5000 })
    expect(detectMissingAttachmentWarning(draft)).toBe(false)
  })

  it('supports undo-send scheduling and cancellation', async () => {
    vi.useFakeTimers()
    const undoManager = new UndoSendManager()
    let sendExecuted = false

    const sendPromise = undoManager.scheduleWithUndo('sub-123', 5, async () => {
      sendExecuted = true
      return {
        submissionId: 'sub-123',
        idempotencyKey: 'idem-1' as IdempotencyKey,
        messageId: 'msg-out' as MessageId,
        status: 'sent',
        submittedAt: new Date().toISOString(),
      }
    })

    expect(undoManager.isPending('sub-123')).toBe(true)
    expect(sendExecuted).toBe(false)

    // Advance 6 seconds
    vi.advanceTimersByTime(6000)
    const result = await sendPromise
    expect(result.status).toBe('sent')
    expect(sendExecuted).toBe(true)
    expect(undoManager.isPending('sub-123')).toBe(false)

    // Test cancellation
    const cancelPromise = undoManager.scheduleWithUndo('sub-cancel', 10, async () => ({
      submissionId: 'sub-cancel',
      idempotencyKey: 'idem-cancel' as IdempotencyKey,
      messageId: 'msg-cancel' as MessageId,
      status: 'sent',
      submittedAt: new Date().toISOString(),
    }))
    expect(undoManager.cancel('sub-cancel')).toBe(true)
    await expect(cancelPromise).rejects.toThrow('Submission cancelled by user undo')

    vi.useRealTimers()
  })

  it('builds submission request and enforces 25MB attachment limit', () => {
    const draft = createNewDraft('acc-1', 'user-1', {
      to: [{ address: 'alice@example.com' }],
      subject: 'Large file',
      attachments: [{ filename: 'huge.zip', mimeType: 'application/zip', size: 30 * 1024 * 1024 }],
    })

    expect(() =>
      buildSubmissionRequest(draft, { fromAddress: { address: 'me@example.com' } }),
    ).toThrow('exceeds limit of 25MB')
  })
})
