import React, { useState } from 'react'
import type { NormalizedEmail, NormalizedMailbox } from '@navin/mail-gateway'
import type { ConflictRecord, DraftRecord } from '@navin/mail-store'
import type { CapabilityNotice, ThreadSummary } from '@navin/mail-core'
import { StatusBadge } from '../common/StatusBadge.js'
import { ConflictBanner } from '../common/ConflictBanner.js'
import { UnsupportedCapabilityBanner } from '../common/UnsupportedCapabilityBanner.js'
import { UndoToast } from '../common/UndoToast.js'
import { MailboxNav, type NavSection } from '../navigation/MailboxNav.js'
import { ThreadList } from '../list/ThreadList.js'
import { ThreadReader } from '../reader/ThreadReader.js'
import { ComposeModal } from '../compose/ComposeModal.js'
import { SearchBar } from '../search/SearchBar.js'

export interface MailLayoutProps {
  currentAccount: { id: string; username: string }
  availableAccounts: Array<{ id: string; username: string }>
  onSwitchAccount: (accountId: string) => void
  online: boolean
  syncing: boolean
  onToggleOnline: () => void
  mailboxes: NormalizedMailbox[]
  selectedMailboxId?: string
  onSelectMailbox: (id: string) => void
  threads: ThreadSummary[]
  selectedThread?: ThreadSummary
  selectedThreadIds: Set<string>
  onSelectThread: (thread: ThreadSummary) => void
  onToggleSelectThread: (threadId: string) => void
  onSelectAllThreads: (all: boolean) => void
  onStarToggle: (threadId: string, starred: boolean) => void
  onArchive: (threadIds: string[]) => void
  onTrash: (threadIds: string[]) => void
  onMarkRead: (threadIds: string[], read: boolean) => void
  onSpam: (threadIds: string[]) => void
  onSearch: (query: string) => void
  conflicts: ConflictRecord[]
  onResolveConflict: (id: string) => void
  onRetryConflicts: () => void
  capabilityNotices: CapabilityNotice[]
  // Compose
  isComposeOpen: boolean
  activeDraft: DraftRecord | null
  onOpenCompose: (initial?: Partial<DraftRecord>) => void
  onCloseCompose: () => void
  onSaveDraft: (draft: DraftRecord) => void
  onSendDraft: (draft: DraftRecord, scheduleAt?: string) => void
  // Undo Toast
  undoToast: { message: string; seconds: number; onUndo: () => void } | null
  onDismissUndo: () => void
  // Sub-views
  contactsContent?: React.ReactNode
  calendarContent?: React.ReactNode
}

export const MailLayout: React.FC<MailLayoutProps> = ({
  currentAccount,
  availableAccounts,
  onSwitchAccount,
  online,
  syncing,
  onToggleOnline,
  mailboxes,
  selectedMailboxId,
  onSelectMailbox,
  threads,
  selectedThread,
  selectedThreadIds,
  onSelectThread,
  onToggleSelectThread,
  onSelectAllThreads,
  onStarToggle,
  onArchive,
  onTrash,
  onMarkRead,
  onSpam,
  onSearch,
  conflicts,
  onResolveConflict,
  onRetryConflicts,
  capabilityNotices,
  isComposeOpen,
  activeDraft,
  onOpenCompose,
  onCloseCompose,
  onSaveDraft,
  onSendDraft,
  undoToast,
  onDismissUndo,
  contactsContent,
  calendarContent,
}) => {
  const [currentSection, setCurrentSection] = useState<NavSection>('mail')

  return (
    <div className="mail-app-container">
      {/* Top Header */}
      <header className="mail-header">
        <div className="mail-header-brand">
          <span>📬</span>
          <span>Navin Mail</span>
        </div>

        <div className="mail-header-search">
          <SearchBar onSearch={onSearch} />
        </div>

        <div className="mail-header-actions">
          {/* Status Badge */}
          <StatusBadge online={online} syncing={syncing} conflictCount={conflicts.length} />

          {/* Online/Offline Toggle */}
          <button
            type="button"
            onClick={onToggleOnline}
            style={{
              padding: '4px 10px',
              fontSize: '0.8rem',
              borderRadius: '4px',
              border: '1px solid var(--navin-border)',
              background: 'var(--navin-surface)',
              cursor: 'pointer',
            }}
            aria-label={online ? 'Simulate going offline' : 'Reconnect online'}
          >
            {online ? 'Go Offline' : 'Reconnect Online'}
          </button>

          {/* Account Selector */}
          <select
            value={currentAccount.id}
            onChange={(e) => onSwitchAccount(e.target.value)}
            aria-label="Active email account"
            style={{
              padding: '6px 10px',
              borderRadius: '4px',
              border: '1px solid var(--navin-border)',
              background: 'var(--navin-surface)',
              fontWeight: 600,
              fontSize: '0.85rem',
            }}
          >
            {availableAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.username}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Capability notices */}
      <UnsupportedCapabilityBanner notices={capabilityNotices} />

      {/* Conflicts Banner */}
      <ConflictBanner
        conflicts={conflicts}
        onResolve={onResolveConflict}
        onRetryAll={onRetryConflicts}
      />

      {/* Main Body */}
      <div className="mail-body">
        <MailboxNav
          mailboxes={mailboxes}
          selectedMailboxId={selectedMailboxId}
          currentSection={currentSection}
          onSelectMailbox={(id) => {
            setCurrentSection('mail')
            onSelectMailbox(id)
          }}
          onSelectSection={(section) => setCurrentSection(section)}
          onOpenCompose={() => onOpenCompose()}
        />

        {currentSection === 'mail' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div
              style={{
                width: selectedThread ? '42%' : '100%',
                borderRight: selectedThread ? '1px solid var(--navin-border)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <ThreadList
                threads={threads}
                selectedThreadIds={selectedThreadIds}
                activeThreadId={selectedThread?.id}
                onSelectThread={onSelectThread}
                onToggleSelect={onToggleSelectThread}
                onSelectAll={onSelectAllThreads}
                onStarToggle={onStarToggle}
                onArchive={onArchive}
                onTrash={onTrash}
                onMarkRead={onMarkRead}
                onSpam={onSpam}
              />
            </div>

            {selectedThread && (
              <div
                style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              >
                <ThreadReader
                  thread={selectedThread}
                  onBack={() => onSelectThread(undefined as any)}
                  onReply={(email: NormalizedEmail, replyAll: boolean) => {
                    onOpenCompose({
                      to: replyAll ? [...email.to, ...email.from] : email.from,
                      subject: `Re: ${email.subject}`,
                      inReplyTo: email.id,
                    })
                  }}
                  onForward={(email: NormalizedEmail) => {
                    onOpenCompose({
                      subject: `Fwd: ${email.subject}`,
                      bodyText: `\n\n---------- Forwarded message ---------\n${email.bodyText || ''}`,
                    })
                  }}
                  onTrashThread={(threadId: string) => onTrash([threadId])}
                />
              </div>
            )}
          </div>
        )}

        {currentSection === 'contacts' && contactsContent}
        {currentSection === 'calendar' && calendarContent}
        {currentSection === 'settings' && (
          <div style={{ padding: '30px', flex: 1, overflowY: 'auto' }}>
            <h2>Mail Settings</h2>
            <p style={{ color: 'var(--navin-text-muted)' }}>
              Configured for account: <strong>{currentAccount.username}</strong>
            </p>
            <div
              style={{
                marginTop: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                maxWidth: '400px',
              }}
            >
              <label>
                <strong>Display Density:</strong>
                <select style={{ width: '100%', padding: '8px', marginTop: '4px' }}>
                  <option>Compact (Gmail-like)</option>
                  <option>Comfortable</option>
                </select>
              </label>
              <label>
                <strong>Offline Cache Quota:</strong>
                <select style={{ width: '100%', padding: '8px', marginTop: '4px' }}>
                  <option>50 MB (Default)</option>
                  <option>100 MB</option>
                  <option>250 MB</option>
                </select>
              </label>
              <label>
                <strong>Signature:</strong>
                <textarea
                  defaultValue="-- Sent via Navin Secure Mail"
                  style={{ width: '100%', padding: '8px', marginTop: '4px', minHeight: '80px' }}
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Compose Modal */}
      {isComposeOpen && activeDraft && (
        <ComposeModal
          draft={activeDraft}
          onClose={onCloseCompose}
          onSaveDraft={onSaveDraft}
          onSend={onSendDraft}
          availableSenderIdentities={[currentAccount.username]}
        />
      )}

      {/* Undo Toast */}
      {undoToast && (
        <UndoToast
          message={undoToast.message}
          seconds={undoToast.seconds}
          onUndo={undoToast.onUndo}
          onDismiss={onDismissUndo}
        />
      )}
    </div>
  )
}
