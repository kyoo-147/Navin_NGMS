import { generateUUID } from '../utils/uuid.js'
import type { NormalizedEmail } from '@navin/mail-gateway'

export type RsvpStatus = 'needs-action' | 'accepted' | 'declined' | 'tentative'

export interface EventAttendee {
  name?: string
  email: string
  rsvpStatus: RsvpStatus
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval?: number
  until?: string
  count?: number
}

export interface CalendarEvent {
  id: string
  accountId: string
  title: string
  description?: string
  location?: string
  startTime: string
  endTime: string
  allDay: boolean
  recurrence?: RecurrenceRule
  attendees: EventAttendee[]
  myRsvpStatus: RsvpStatus
  updatedAt: string
}

export class CalendarManager {
  private readonly events = new Map<string, CalendarEvent>()

  constructor(initialEvents: CalendarEvent[] = []) {
    for (const e of initialEvents) {
      this.events.set(e.id, e)
    }
  }

  createEvent(
    accountId: string,
    data: Omit<CalendarEvent, 'id' | 'accountId' | 'updatedAt'>,
  ): CalendarEvent {
    const event: CalendarEvent = {
      ...data,
      id: generateUUID(),
      accountId,
      updatedAt: new Date().toISOString(),
    }
    this.events.set(event.id, event)
    return event
  }

  updateEvent(
    id: string,
    updates: Partial<Omit<CalendarEvent, 'id' | 'accountId'>>,
  ): CalendarEvent {
    const existing = this.events.get(id)
    if (!existing) {
      throw new Error(`Calendar event ${id} not found`)
    }
    const updated: CalendarEvent = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    this.events.set(id, updated)
    return updated
  }

  deleteEvent(id: string): boolean {
    return this.events.delete(id)
  }

  getEvent(id: string): CalendarEvent | undefined {
    return this.events.get(id)
  }

  listEvents(accountId?: string, range?: { start: string; end: string }): CalendarEvent[] {
    let list = Array.from(this.events.values())
    if (accountId) {
      list = list.filter((e) => e.accountId === accountId)
    }
    if (range) {
      const rangeStart = new Date(range.start).getTime()
      const rangeEnd = new Date(range.end).getTime()
      list = list.filter((e) => {
        const evStart = new Date(e.startTime).getTime()
        const evEnd = new Date(e.endTime).getTime()
        return evEnd >= rangeStart && evStart <= rangeEnd
      })
    }
    return list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }

  setRsvp(eventId: string, email: string, status: RsvpStatus): CalendarEvent {
    const event = this.events.get(eventId)
    if (!event) throw new Error(`Event ${eventId} not found`)

    let foundAttendee = false
    const attendees = event.attendees.map((a) => {
      if (a.email.toLowerCase() === email.toLowerCase()) {
        foundAttendee = true
        return { ...a, rsvpStatus: status }
      }
      return a
    })

    if (!foundAttendee) {
      attendees.push({ email, rsvpStatus: status })
    }

    const updated: CalendarEvent = {
      ...event,
      attendees,
      myRsvpStatus: status,
      updatedAt: new Date().toISOString(),
    }
    this.events.set(eventId, updated)
    return updated
  }

  /**
   * Expands recurring events within a given date window.
   */
  expandRecurringOccurrences(
    event: CalendarEvent,
    rangeStart: string,
    rangeEnd: string,
  ): CalendarEvent[] {
    if (!event.recurrence) return [event]

    const occurrences: CalendarEvent[] = []
    const startMs = new Date(rangeStart).getTime()
    const endMs = new Date(rangeEnd).getTime()
    const eventStart = new Date(event.startTime)
    const eventEnd = new Date(event.endTime)
    const durationMs = eventEnd.getTime() - eventStart.getTime()

    const untilMs = event.recurrence.until ? new Date(event.recurrence.until).getTime() : endMs
    const maxCount = event.recurrence.count ?? 50
    const interval = event.recurrence.interval ?? 1

    let currentStart = new Date(eventStart)
    let count = 0

    while (
      currentStart.getTime() <= untilMs &&
      currentStart.getTime() <= endMs &&
      count < maxCount
    ) {
      const currentEnd = new Date(currentStart.getTime() + durationMs)
      if (currentEnd.getTime() >= startMs && currentStart.getTime() <= endMs) {
        occurrences.push({
          ...event,
          id: `${event.id}_occ_${count}`,
          startTime: currentStart.toISOString(),
          endTime: currentEnd.toISOString(),
        })
      }

      count++
      if (event.recurrence.frequency === 'daily') {
        currentStart.setDate(currentStart.getDate() + interval)
      } else if (event.recurrence.frequency === 'weekly') {
        currentStart.setDate(currentStart.getDate() + 7 * interval)
      } else if (event.recurrence.frequency === 'monthly') {
        currentStart.setMonth(currentStart.getMonth() + interval)
      } else if (event.recurrence.frequency === 'yearly') {
        currentStart.setFullYear(currentStart.getFullYear() + interval)
      }
    }

    return occurrences
  }

  /**
   * Creates a calendar event draft directly from an email.
   */
  createEventFromMail(email: NormalizedEmail, accountId: string): CalendarEvent {
    // Default start time: tomorrow at 10:00 AM or 1 hour from received
    const start = new Date(email.receivedAt)
    start.setDate(start.getDate() + 1)
    start.setHours(10, 0, 0, 0)
    const end = new Date(start)
    end.setHours(11, 0, 0, 0)

    const originalSender = email.from[0] ?? { address: 'unknown@example.invalid' }
    const attendees: EventAttendee[] = [
      { name: originalSender.name, email: originalSender.address, rsvpStatus: 'needs-action' },
      ...email.to.map((t) => ({
        name: t.name,
        email: t.address,
        rsvpStatus: 'needs-action' as RsvpStatus,
      })),
    ]

    return this.createEvent(accountId, {
      title: email.subject.replace(/^(Re|Fwd):\s*/i, ''),
      description: `From email: ${email.subject}\n\n${(email.bodyText ?? '').slice(0, 300)}`,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      allDay: false,
      attendees,
      myRsvpStatus: 'accepted',
    })
  }

  /**
   * Exports an event to standard iCalendar (.ics RFC 5545).
   */
  exportIcs(event: CalendarEvent): string {
    const formatIcsDate = (iso: string) =>
      new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Navin Mail//NONSGML Calendar//EN',
      'BEGIN:VEVENT',
      `UID:${event.id}@example.invalid`,
      `DTSTAMP:${formatIcsDate(event.updatedAt)}`,
      `DTSTART:${formatIcsDate(event.startTime)}`,
      `DTEND:${formatIcsDate(event.endTime)}`,
      `SUMMARY:${event.title}`,
    ]

    if (event.description) lines.push(`DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`)
    if (event.location) lines.push(`LOCATION:${event.location}`)

    for (const a of event.attendees) {
      lines.push(
        `ATTENDEE;CN=${a.name || a.email};PARTSTAT=${a.rsvpStatus.toUpperCase()}:mailto:${a.email}`,
      )
    }

    lines.push('END:VEVENT')
    lines.push('END:VCALENDAR')
    return lines.join('\r\n')
  }

  /**
   * Parses an iCalendar (.ics) string and adds events to manager.
   */
  parseIcs(icsText: string, accountId: string): CalendarEvent[] {
    const events: CalendarEvent[] = []
    const veventBlocks = icsText.split(/BEGIN:VEVENT/i).slice(1)

    for (const block of veventBlocks) {
      const eventContent = block.split(/END:VEVENT/i)[0] ?? ''
      const lines = eventContent.split(/\r?\n/)

      let title = 'Untitled Event'
      let description: string | undefined
      let location: string | undefined
      let startTime = new Date().toISOString()
      let endTime = new Date(Date.now() + 3600000).toISOString()
      const attendees: EventAttendee[] = []

      for (const line of lines) {
        const [rawKey, ...valParts] = line.split(':')
        if (!rawKey || valParts.length === 0) continue
        const key = rawKey.split(';')[0]?.toUpperCase().trim()
        const val = valParts.join(':').trim()

        if (key === 'SUMMARY') {
          title = val
        } else if (key === 'DESCRIPTION') {
          description = val.replace(/\\n/g, '\n')
        } else if (key === 'LOCATION') {
          location = val
        } else if (key === 'DTSTART') {
          startTime = parseIcsDate(val)
        } else if (key === 'DTEND') {
          endTime = parseIcsDate(val)
        } else if (key === 'ATTENDEE') {
          const email = val.replace(/^mailto:/i, '')
          attendees.push({ email, rsvpStatus: 'needs-action' })
        }
      }

      const event = this.createEvent(accountId, {
        title,
        description,
        location,
        startTime,
        endTime,
        allDay: false,
        attendees,
        myRsvpStatus: 'needs-action',
      })
      events.push(event)
    }

    return events
  }
}

function parseIcsDate(val: string): string {
  // Format: 20261001T120000Z or 20261001
  const clean = val.replace(/[^0-9TZ]/g, '')
  if (clean.length >= 15) {
    const year = clean.slice(0, 4)
    const month = clean.slice(4, 6)
    const day = clean.slice(6, 8)
    const hour = clean.slice(9, 11)
    const min = clean.slice(11, 13)
    const sec = clean.slice(13, 15)
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString()
  }
  return new Date().toISOString()
}
