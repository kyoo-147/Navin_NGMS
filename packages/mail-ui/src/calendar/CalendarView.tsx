import React, { useState } from 'react'
import type { CalendarEvent, CalendarManager, RsvpStatus } from '@navin/mail-core'

export interface CalendarViewProps {
  calendarManager: CalendarManager
  accountId: string
  currentUserEmail?: string
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  calendarManager,
  accountId,
  currentUserEmail = 'me@example.com',
}) => {
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formStart, setFormStart] = useState('')
  const [formEnd, setFormEnd] = useState('')
  const [formLocation, setFormLocation] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [, setRefresh] = useState(0)

  const events = calendarManager.listEvents(accountId)

  const handleStartCreate = () => {
    setSelectedEvent(null)
    setFormTitle('')
    const now = new Date()
    now.setMinutes(0, 0, 0)
    setFormStart(now.toISOString().slice(0, 16))
    const later = new Date(now.getTime() + 3600000)
    setFormEnd(later.toISOString().slice(0, 16))
    setFormLocation('')
    setFormDesc('')
    setIsCreating(true)
  }

  const handleSave = () => {
    if (!formTitle || !formStart || !formEnd) return
    calendarManager.createEvent(accountId, {
      title: formTitle,
      startTime: new Date(formStart).toISOString(),
      endTime: new Date(formEnd).toISOString(),
      location: formLocation || undefined,
      description: formDesc || undefined,
      allDay: false,
      attendees: [{ email: currentUserEmail, rsvpStatus: 'accepted' }],
      myRsvpStatus: 'accepted',
    })
    setIsCreating(false)
    setRefresh((r) => r + 1)
  }

  const handleDelete = (id: string) => {
    calendarManager.deleteEvent(id)
    setSelectedEvent(null)
    setRefresh((r) => r + 1)
  }

  const handleRsvp = (eventId: string, status: RsvpStatus) => {
    calendarManager.setRsvp(eventId, currentUserEmail, status)
    if (selectedEvent && selectedEvent.id === eventId) {
      setSelectedEvent(calendarManager.getEvent(eventId) ?? null)
    }
    setRefresh((r) => r + 1)
  }

  const handleExportIcs = (event: CalendarEvent) => {
    const ics = calendarManager.exportIcs(event)
    const blob = new Blob([ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${event.title.replace(/\s+/g, '_')}.ics`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Event Agenda List */}
      <div
        style={{
          width: '340px',
          borderRight: '1px solid var(--navin-border)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--navin-surface)',
        }}
      >
        <div
          style={{
            padding: '12px',
            borderBottom: '1px solid var(--navin-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Events Agenda</h3>
          <button
            type="button"
            onClick={handleStartCreate}
            style={{
              padding: '6px 12px',
              background: 'var(--navin-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            + New Event
          </button>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', flex: 1 }}>
          {events.map((e) => (
            <li
              key={e.id}
              onClick={() => {
                setSelectedEvent(e)
                setIsCreating(false)
              }}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--navin-border)',
                cursor: 'pointer',
                backgroundColor: selectedEvent?.id === e.id ? '#e0f2fe' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600 }}>{e.title}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--navin-text-muted)' }}>
                {new Date(e.startTime).toLocaleDateString()}{' '}
                {new Date(e.startTime).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                -{' '}
                {new Date(e.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              {e.location && (
                <div style={{ fontSize: '0.75rem', color: 'var(--navin-text-muted)' }}>
                  📍 {e.location}
                </div>
              )}
            </li>
          ))}
          {events.length === 0 && (
            <li style={{ padding: '20px', textAlign: 'center', color: 'var(--navin-text-muted)' }}>
              No events scheduled
            </li>
          )}
        </ul>
      </div>

      {/* Details / Create Pane */}
      <div style={{ flex: 1, padding: '24px', overflowY: 'auto', background: 'var(--navin-bg)' }}>
        {isCreating ? (
          <div
            style={{
              maxWidth: '480px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: '#fff',
              padding: '20px',
              borderRadius: '8px',
              border: '1px solid var(--navin-border)',
            }}
          >
            <h3>New Calendar Event</h3>
            <label>
              Title:
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                style={{ width: '100%', padding: '6px', marginTop: '4px' }}
              />
            </label>
            <label>
              Start Time:
              <input
                type="datetime-local"
                value={formStart}
                onChange={(e) => setFormStart(e.target.value)}
                style={{ width: '100%', padding: '6px', marginTop: '4px' }}
              />
            </label>
            <label>
              End Time:
              <input
                type="datetime-local"
                value={formEnd}
                onChange={(e) => setFormEnd(e.target.value)}
                style={{ width: '100%', padding: '6px', marginTop: '4px' }}
              />
            </label>
            <label>
              Location:
              <input
                type="text"
                value={formLocation}
                onChange={(e) => setFormLocation(e.target.value)}
                style={{ width: '100%', padding: '6px', marginTop: '4px' }}
              />
            </label>
            <label>
              Description:
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                style={{ width: '100%', padding: '6px', marginTop: '4px' }}
              />
            </label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={handleSave}
                style={{
                  padding: '8px 16px',
                  background: 'var(--navin-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Create Event
              </button>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                style={{
                  padding: '8px 16px',
                  background: 'none',
                  border: '1px solid var(--navin-border)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : selectedEvent ? (
          <div
            style={{
              maxWidth: '520px',
              background: '#fff',
              padding: '24px',
              borderRadius: '8px',
              border: '1px solid var(--navin-border)',
            }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
            >
              <div>
                <h2 style={{ margin: '0 0 6px 0' }}>{selectedEvent.title}</h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--navin-text-muted)' }}>
                  {new Date(selectedEvent.startTime).toLocaleString()} -{' '}
                  {new Date(selectedEvent.endTime).toLocaleTimeString()}
                </div>
                {selectedEvent.location && (
                  <div style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                    📍 {selectedEvent.location}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleExportIcs(selectedEvent)}
                  style={{ padding: '6px 10px', fontSize: '0.8rem', cursor: 'pointer' }}
                >
                  Export .ics
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(selectedEvent.id)}
                  style={{
                    padding: '6px 10px',
                    fontSize: '0.8rem',
                    color: '#ef4444',
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* RSVP Section */}
            <div
              style={{
                marginTop: '20px',
                padding: '12px',
                backgroundColor: '#f8fafc',
                borderRadius: '6px',
                border: '1px solid var(--navin-border)',
              }}
            >
              <strong>RSVP Status:</strong> {selectedEvent.myRsvpStatus}
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleRsvp(selectedEvent.id, 'accepted')}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '4px',
                    border: '1px solid #22c55e',
                    backgroundColor: selectedEvent.myRsvpStatus === 'accepted' ? '#22c55e' : '#fff',
                    color: selectedEvent.myRsvpStatus === 'accepted' ? '#fff' : '#15803d',
                    cursor: 'pointer',
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => handleRsvp(selectedEvent.id, 'tentative')}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '4px',
                    border: '1px solid #f59e0b',
                    backgroundColor:
                      selectedEvent.myRsvpStatus === 'tentative' ? '#f59e0b' : '#fff',
                    color: selectedEvent.myRsvpStatus === 'tentative' ? '#fff' : '#b45309',
                    cursor: 'pointer',
                  }}
                >
                  Maybe
                </button>
                <button
                  type="button"
                  onClick={() => handleRsvp(selectedEvent.id, 'declined')}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '4px',
                    border: '1px solid #ef4444',
                    backgroundColor: selectedEvent.myRsvpStatus === 'declined' ? '#ef4444' : '#fff',
                    color: selectedEvent.myRsvpStatus === 'declined' ? '#fff' : '#b91c1c',
                    cursor: 'pointer',
                  }}
                >
                  No
                </button>
              </div>
            </div>

            {selectedEvent.description && (
              <div style={{ marginTop: '16px' }}>
                <strong>Description:</strong>
                <p style={{ whiteSpace: 'pre-wrap', color: '#334155' }}>
                  {selectedEvent.description}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: 'var(--navin-text-muted)', textAlign: 'center', marginTop: '40px' }}>
            Select an event to view details or click + New Event.
          </div>
        )}
      </div>
    </div>
  )
}
