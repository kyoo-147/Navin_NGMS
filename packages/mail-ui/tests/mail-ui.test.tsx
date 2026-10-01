import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MailboxNav } from '../src/navigation/MailboxNav.js'
import { ThreadList } from '../src/list/ThreadList.js'
import { SecureHtmlViewer } from '../src/reader/SecureHtmlViewer.js'
import { ComposeModal } from '../src/compose/ComposeModal.js'
import { ContactsView } from '../src/contacts/ContactsView.js'
import { CalendarView } from '../src/calendar/CalendarView.js'
import { ContactsManager, CalendarManager, type ThreadSummary } from '@navin/mail-core'
import type { NormalizedMailbox } from '@navin/mail-gateway'
import type { FolderId, MailboxId, MessageId, ThreadId } from '@navin/contracts'
import type { DraftRecord } from '@navin/mail-store'

const mailboxRights = {
  mayReadItems: true,
  mayAddItems: true,
  mayRemoveItems: true,
  maySetSeen: true,
  maySetKeywords: true,
  mayCreateChild: false,
  mayRename: false,
  mayDelete: false,
  maySubmit: true,
}

describe('Mail UI Components', () => {
  const sampleMailboxes: NormalizedMailbox[] = [
    {
      id: 'mb-inbox' as MailboxId,
      folderId: 'fld-inbox' as FolderId,
      name: 'Inbox',
      parentId: null,
      role: 'inbox',
      rawRole: 'inbox',
      sortOrder: 1,
      totalEmails: 10,
      unreadEmails: 3,
      totalThreads: 8,
      unreadThreads: 2,
      isSubscribed: true,
      rights: mailboxRights,
    },
    {
      id: 'mb-sent' as MailboxId,
      folderId: 'fld-sent' as FolderId,
      name: 'Sent',
      parentId: null,
      role: 'sent',
      rawRole: 'sent',
      sortOrder: 2,
      totalEmails: 5,
      unreadEmails: 0,
      totalThreads: 5,
      unreadThreads: 0,
      isSubscribed: true,
      rights: mailboxRights,
    },
  ]

  const sampleThread: ThreadSummary = {
    id: 'th-1' as ThreadId,
    subject: 'Sprint Planning',
    messages: [
      {
        id: 'msg-1' as MessageId,
        threadId: 'th-1' as ThreadId,
        mailboxIds: ['mb-inbox' as MailboxId],
        keywords: [],
        isUnread: true,
        isStarred: false,
        isDraft: false,
        isAnswered: false,
        hasAttachment: true,
        size: 500,
        preview: 'Let us discuss tickets',
        subject: 'Sprint Planning',
        from: [{ name: 'Alice', address: 'alice@example.com' }],
        to: [{ name: 'Bob', address: 'bob@example.com' }],
        cc: [],
        bcc: [],
        replyTo: [],
        sentAt: '2026-10-01T10:00:00.000Z',
        receivedAt: '2026-10-01T10:00:05.000Z',
        bodyText: 'Let us discuss tickets for sprint 24.',
        bodyHtml: '<p>Let us discuss tickets for sprint 24.</p>',
        attachments: [{ filename: 'tickets.csv', mimeType: 'text/csv', size: 1024 }],
        messageId: ['<m1@example.invalid>'],
        inReplyTo: null,
        references: null,
      },
    ],
    messageCount: 1,
    unreadCount: 1,
    isStarred: false,
    hasAttachment: true,
    participants: [{ name: 'Alice', address: 'alice@example.com' }],
    latestReceivedAt: '2026-10-01T10:00:05.000Z',
    snippet: 'Let us discuss tickets',
    mailboxIds: ['mb-inbox' as MailboxId],
  }

  it('renders MailboxNav with unread counts and handles clicks', () => {
    const onSelect = vi.fn()
    const onCompose = vi.fn()
    const onSection = vi.fn()

    render(
      <MailboxNav
        mailboxes={sampleMailboxes}
        selectedMailboxId="mb-inbox"
        currentSection="mail"
        onSelectMailbox={onSelect}
        onSelectSection={onSection}
        onOpenCompose={onCompose}
      />,
    )

    expect(screen.getByText('Inbox')).toBeDefined()
    expect(screen.getByText('3')).toBeDefined() // unread count

    fireEvent.click(screen.getByText('Sent'))
    expect(onSelect).toHaveBeenCalledWith('mb-sent')

    fireEvent.click(screen.getByText('Compose'))
    expect(onCompose).toHaveBeenCalled()
  })

  it('renders ThreadList with row details and selection', () => {
    const onSelectThread = vi.fn()
    const onToggleSelect = vi.fn()
    const onSelectAll = vi.fn()
    const onStar = vi.fn()
    const onArchive = vi.fn()
    const onTrash = vi.fn()
    const onMarkRead = vi.fn()
    const onSpam = vi.fn()

    render(
      <ThreadList
        threads={[sampleThread]}
        selectedThreadIds={new Set(['th-1'])}
        activeThreadId="th-1"
        onSelectThread={onSelectThread}
        onToggleSelect={onToggleSelect}
        onSelectAll={onSelectAll}
        onStarToggle={onStar}
        onArchive={onArchive}
        onTrash={onTrash}
        onMarkRead={onMarkRead}
        onSpam={onSpam}
      />,
    )

    expect(screen.getByText('Sprint Planning')).toBeDefined()
    expect(screen.getByText(/Alice/)).toBeDefined()
    expect(screen.getByText(/Let us discuss tickets/)).toBeDefined()

    // Bulk action toolbar should be visible when selected
    const archiveBtn = screen.getByLabelText('Archive selected')
    expect(archiveBtn).toBeDefined()
    fireEvent.click(archiveBtn)
    expect(onArchive).toHaveBeenCalledWith(['th-1'])
  })

  it('renders SecureHtmlViewer, blocks remote images, and warns on suspicious links', () => {
    const htmlWithTracker = `
      <p>Please update info:</p>
      <img src="https://tracker.invalid/img.png" alt="tracker" />
      <a href="https://phish.invalid/login">https://mybank.example.com</a>
    `
    render(
      <SecureHtmlViewer html={htmlWithTracker} plainTextFallback="Fallback" attachments={[]} />,
    )

    // Image blocking notice
    expect(screen.getByText(/remote image blocked to protect your privacy/i)).toBeDefined()
    expect(screen.getByText(/protected image proxy.*not available/i)).toBeDefined()
    expect(document.body.innerHTML).not.toContain('tracker.invalid')

    // Suspicious link warning
    expect(screen.getByText(/Security Warning/i)).toBeDefined()
    expect(screen.getByText(/points to/i)).toBeDefined()
  })

  it('handles compose modal validation and missing attachment warnings', () => {
    const draft: DraftRecord = {
      id: 'draft-test',
      accountId: 'acc-1',
      senderIdentityId: 'alice@example.com',
      to: [],
      cc: [],
      bcc: [],
      subject: 'Attached contract',
      bodyText: 'Please see attached contract.',
      bodyHtml: '<p>Please see attached contract.</p>',
      attachments: [],
      references: [],
      updatedAt: '2026-10-01T10:00:00.000Z',
      status: 'draft',
    }

    const onSend = vi.fn()
    const onSave = vi.fn()
    const onClose = vi.fn()

    const { rerender } = render(
      <ComposeModal
        draft={draft}
        onClose={onClose}
        onSaveDraft={onSave}
        onSend={onSend}
        availableSenderIdentities={['alice@example.com']}
      />,
    )

    // Attempt to send with empty To recipient
    const sendBtn = screen.getByLabelText('Send email')
    fireEvent.click(sendBtn)
    expect(screen.getByText(/At least one recipient/i)).toBeDefined()
    expect(onSend).not.toHaveBeenCalled()

    // Add recipient and test missing attachment prompt
    const draftWithTo: DraftRecord = {
      ...draft,
      to: [{ address: 'bob@example.com' }],
    }

    rerender(
      <ComposeModal
        draft={draftWithTo}
        onClose={onClose}
        onSaveDraft={onSave}
        onSend={onSend}
        availableSenderIdentities={['alice@example.com']}
      />,
    )

    fireEvent.click(screen.getByLabelText('Send email'))
    expect(screen.getByText(/Did you forget to attach a file/i)).toBeDefined()

    // Click "Send Anyway"
    fireEvent.click(screen.getByText('Send Anyway'))
    expect(onSend).toHaveBeenCalled()
  })

  it('renders ContactsView and CalendarView', () => {
    const contactsMgr = new ContactsManager()
    contactsMgr.createContact('acc-1', {
      name: 'Bob Jones',
      email: 'bob@company.test',
      groups: ['colleagues'],
    })

    const { unmount } = render(<ContactsView contactsManager={contactsMgr} accountId="acc-1" />)
    expect(screen.getByText('Bob Jones')).toBeDefined()
    expect(screen.getByText('bob@company.test')).toBeDefined()
    unmount()

    const calendarMgr = new CalendarManager()
    calendarMgr.createEvent('acc-1', {
      title: 'Quarterly Planning',
      startTime: '2026-10-01T14:00:00.000Z',
      endTime: '2026-10-01T15:00:00.000Z',
      allDay: false,
      attendees: [{ email: 'bob@company.test', rsvpStatus: 'needs-action' }],
      myRsvpStatus: 'needs-action',
    })

    render(
      <CalendarView
        calendarManager={calendarMgr}
        accountId="acc-1"
        currentUserEmail="bob@company.test"
      />,
    )
    expect(screen.getByText('Quarterly Planning')).toBeDefined()
    expect(screen.getByText('+ New Event')).toBeDefined()
  })
})
