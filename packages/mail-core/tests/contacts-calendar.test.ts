import { describe, it, expect } from 'vitest'
import { ContactsManager } from '../src/contacts/contacts-manager.js'
import { CalendarManager } from '../src/calendar/calendar-manager.js'
import type { NormalizedEmail } from '@navin/mail-gateway'
import type { MailboxId, MessageId, ThreadId } from '@navin/contracts'

describe('Contacts and Calendar', () => {
  it('handles contact CRUD, autocomplete, and duplicate detection', () => {
    const manager = new ContactsManager()
    const c1 = manager.createContact('acc-1', {
      name: 'Alice Smith',
      email: 'alice@example.com',
      phone: '+1-555-0100',
      company: 'Acme Corp',
      groups: ['colleagues', 'engineering'],
    })

    const c2 = manager.createContact('acc-1', {
      name: 'Bob Jones',
      email: 'bob@company.test',
      groups: ['friends'],
    })
    expect(c2.email).toBe('bob@company.test')

    // Autocomplete
    expect(manager.autocomplete('alice')).toHaveLength(1)
    expect(manager.autocomplete('555')).toHaveLength(0) // searches name/email
    expect(manager.autocomplete('bob@')).toHaveLength(1)

    // Add duplicate email
    manager.createContact('acc-1', {
      name: 'Alice Duplicate',
      email: 'alice@example.com',
      groups: ['family'],
    })

    const duplicates = manager.findDuplicates('acc-1')
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.contacts).toHaveLength(2)

    // Merge duplicates
    const merged = manager.mergeContacts(c1.id, duplicates[0]!.contacts[1]!.id)
    expect(merged.groups).toContain('colleagues')
    expect(merged.groups).toContain('family')
    expect(manager.listContacts('acc-1')).toHaveLength(2)
  })

  it('imports and exports contacts via vCard and CSV', () => {
    const manager = new ContactsManager()
    manager.createContact('acc-1', {
      name: 'Carol White',
      email: 'carol@example.com',
      phone: '+1-555-0199',
      company: 'Widgets Inc',
      groups: ['sales'],
    })

    const vcard = manager.exportVCard('acc-1')
    expect(vcard).toContain('BEGIN:VCARD')
    expect(vcard).toContain('FN:Carol White')
    expect(vcard).toContain('EMAIL:carol@example.com')

    const newManager = new ContactsManager()
    const importedVCard = newManager.importVCard(vcard, 'acc-2')
    expect(importedVCard).toHaveLength(1)
    expect(importedVCard[0]?.name).toBe('Carol White')
    expect(importedVCard[0]?.accountId).toBe('acc-2')

    const csv = manager.exportCsv('acc-1')
    expect(csv).toContain('Name,Email,Phone,Company')
    expect(csv).toContain('"Carol White","carol@example.com"')

    const importedCsv = newManager.importCsv(csv, 'acc-3')
    expect(importedCsv).toHaveLength(1)
    expect(importedCsv[0]?.name).toBe('Carol White')
  })

  it('manages calendar events, RSVP status, recurrence, and ICS export/import', () => {
    const cal = new CalendarManager()
    const event = cal.createEvent('acc-1', {
      title: 'Weekly Standup',
      description: 'Discuss sprint progress',
      location: 'Room A',
      startTime: '2026-10-01T09:00:00.000Z',
      endTime: '2026-10-01T09:30:00.000Z',
      allDay: false,
      recurrence: { frequency: 'weekly', interval: 1, count: 4 },
      attendees: [
        { name: 'Alice', email: 'alice@example.com', rsvpStatus: 'accepted' },
        { name: 'Bob', email: 'bob@example.com', rsvpStatus: 'needs-action' },
      ],
      myRsvpStatus: 'accepted',
    })

    // RSVP update
    const updated = cal.setRsvp(event.id, 'bob@example.com', 'accepted')
    expect(updated.attendees.find((a) => a.email === 'bob@example.com')?.rsvpStatus).toBe(
      'accepted',
    )

    // Recurrence expansion over 1 month
    const occurrences = cal.expandRecurringOccurrences(
      event,
      '2026-10-01T00:00:00.000Z',
      '2026-10-31T23:59:59.000Z',
    )
    expect(occurrences).toHaveLength(4)

    // ICS export & parse
    const ics = cal.exportIcs(event)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('SUMMARY:Weekly Standup')

    const newCal = new CalendarManager()
    const parsed = newCal.parseIcs(ics, 'acc-2')
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.title).toBe('Weekly Standup')
  })

  it('creates calendar events directly from emails', () => {
    const cal = new CalendarManager()
    const email: NormalizedEmail = {
      id: 'msg-cal' as MessageId,
      threadId: 'th-1' as ThreadId,
      mailboxIds: ['mb-1' as MailboxId],
      keywords: [],
      isUnread: false,
      isStarred: false,
      isDraft: false,
      isAnswered: false,
      hasAttachment: false,
      size: 100,
      preview: 'Let us meet tomorrow',
      subject: 'Architecture Discussion',
      from: [{ name: 'Dave', address: 'dave@example.com' }],
      to: [{ name: 'Alice', address: 'alice@example.com' }],
      cc: [],
      bcc: [],
      replyTo: [],
      sentAt: '2026-10-01T12:00:00.000Z',
      receivedAt: '2026-10-01T12:00:05.000Z',
      bodyText: 'Let us meet tomorrow to discuss the schema changes.',
      bodyHtml: null,
      attachments: [],
      messageId: ['<cal@example.invalid>'],
      inReplyTo: null,
      references: null,
    }

    const event = cal.createEventFromMail(email, 'acc-1')
    expect(event.title).toBe('Architecture Discussion')
    expect(event.attendees).toHaveLength(2)
    expect(event.description).toContain('schema changes')
  })
})
