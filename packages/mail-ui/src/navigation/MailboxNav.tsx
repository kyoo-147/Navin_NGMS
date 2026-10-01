import React from 'react'
import type { NormalizedMailbox } from '@navin/mail-gateway'

export type NavSection = 'mail' | 'contacts' | 'calendar' | 'settings'

export interface MailboxNavProps {
  mailboxes: NormalizedMailbox[]
  selectedMailboxId?: string
  currentSection: NavSection
  onSelectMailbox: (mailboxId: string) => void
  onSelectSection: (section: NavSection) => void
  onOpenCompose: () => void
}

const ROLE_ICONS: Record<string, string> = {
  inbox: '📥',
  starred: '⭐',
  snoozed: '⏰',
  sent: '📤',
  drafts: '📝',
  scheduled: '📅',
  spam: '🚫',
  trash: '🗑️',
  archive: '📦',
  all: '📬',
}

export const MailboxNav: React.FC<MailboxNavProps> = ({
  mailboxes,
  selectedMailboxId,
  currentSection,
  onSelectMailbox,
  onSelectSection,
  onOpenCompose,
}) => {
  return (
    <nav className="mail-sidebar" aria-label="Mailbox and application navigation">
      <button
        type="button"
        className="mail-compose-btn"
        onClick={onOpenCompose}
        aria-label="Compose new email"
      >
        <span>✏️</span>
        <span>Compose</span>
      </button>

      <div
        style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '8px',
          borderBottom: '1px solid var(--navin-border)',
          paddingBottom: '8px',
        }}
      >
        <button
          type="button"
          className={`mail-nav-item ${currentSection === 'mail' ? 'active' : ''}`}
          onClick={() => onSelectSection('mail')}
          style={{ justifyContent: 'center', padding: '6px' }}
          aria-label="Mail section"
        >
          ✉️ Mail
        </button>
        <button
          type="button"
          className={`mail-nav-item ${currentSection === 'contacts' ? 'active' : ''}`}
          onClick={() => onSelectSection('contacts')}
          style={{ justifyContent: 'center', padding: '6px' }}
          aria-label="Contacts section"
        >
          👥 Contacts
        </button>
        <button
          type="button"
          className={`mail-nav-item ${currentSection === 'calendar' ? 'active' : ''}`}
          onClick={() => onSelectSection('calendar')}
          style={{ justifyContent: 'center', padding: '6px' }}
          aria-label="Calendar section"
        >
          📆 Calendar
        </button>
      </div>

      {currentSection === 'mail' && (
        <ul className="mail-nav-list" role="list" aria-label="Mailboxes">
          {mailboxes.map((mb) => {
            const isSelected = selectedMailboxId === mb.id
            const icon = (mb.role && ROLE_ICONS[mb.role]) || '📁'
            return (
              <li key={mb.id} role="listitem">
                <button
                  type="button"
                  className={`mail-nav-item ${isSelected ? 'active' : ''}`}
                  onClick={() => onSelectMailbox(mb.id)}
                  aria-current={isSelected ? 'page' : undefined}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      overflow: 'hidden',
                    }}
                  >
                    <span>{icon}</span>
                    <span
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {mb.name}
                    </span>
                  </span>
                  {mb.unreadEmails > 0 && (
                    <span
                      className="mail-nav-badge"
                      aria-label={`${mb.unreadEmails} unread emails`}
                    >
                      {mb.unreadEmails}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {currentSection === 'settings' && (
        <div style={{ padding: '8px 12px', fontSize: '0.85rem', color: 'var(--navin-text-muted)' }}>
          Settings & Preferences
        </div>
      )}
    </nav>
  )
}
