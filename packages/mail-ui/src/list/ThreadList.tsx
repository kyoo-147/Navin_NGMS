import React, { useState, useEffect } from 'react'
import type { ThreadSummary } from '@navin/mail-core'

export interface ThreadListProps {
  threads: ThreadSummary[]
  selectedThreadIds: Set<string>
  activeThreadId?: string
  onSelectThread: (thread: ThreadSummary) => void
  onToggleSelect: (threadId: string) => void
  onSelectAll: (all: boolean) => void
  onStarToggle: (threadId: string, starred: boolean) => void
  onArchive: (threadIds: string[]) => void
  onTrash: (threadIds: string[]) => void
  onMarkRead: (threadIds: string[], read: boolean) => void
  onSpam: (threadIds: string[]) => void
}

export const ThreadList: React.FC<ThreadListProps> = ({
  threads,
  selectedThreadIds,
  activeThreadId,
  onSelectThread,
  onToggleSelect,
  onSelectAll,
  onStarToggle,
  onArchive,
  onTrash,
  onMarkRead,
  onSpam,
}) => {
  const [focusedIndex, setFocusedIndex] = useState<number>(0)

  const allSelected = threads.length > 0 && threads.every((t) => selectedThreadIds.has(t.id))
  const someSelected = threads.some((t) => selectedThreadIds.has(t.id))

  // Keyboard navigation (j/k, x, s, e, #, Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing inside input, textarea, or contentEditable
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      const currentThread = threads[focusedIndex]

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) => Math.min(threads.length - 1, prev + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => Math.max(0, prev - 1))
      } else if (e.key === 'Enter' || e.key === 'o') {
        if (currentThread) {
          e.preventDefault()
          onSelectThread(currentThread)
        }
      } else if (e.key === 'x') {
        if (currentThread) {
          e.preventDefault()
          onToggleSelect(currentThread.id)
        }
      } else if (e.key === 's') {
        if (currentThread) {
          e.preventDefault()
          onStarToggle(currentThread.id, !currentThread.isStarred)
        }
      } else if (e.key === 'e') {
        const ids =
          selectedThreadIds.size > 0
            ? Array.from(selectedThreadIds)
            : currentThread
              ? [currentThread.id]
              : []
        if (ids.length > 0) {
          e.preventDefault()
          onArchive(ids)
        }
      } else if (e.key === '#') {
        const ids =
          selectedThreadIds.size > 0
            ? Array.from(selectedThreadIds)
            : currentThread
              ? [currentThread.id]
              : []
        if (ids.length > 0) {
          e.preventDefault()
          onTrash(ids)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    threads,
    focusedIndex,
    selectedThreadIds,
    onSelectThread,
    onToggleSelect,
    onStarToggle,
    onArchive,
    onTrash,
  ])

  const selectedList = Array.from(selectedThreadIds)

  return (
    <div className="mail-main-pane">
      {/* Toolbar */}
      <div className="mail-toolbar" role="toolbar" aria-label="Mail actions">
        <div className="mail-toolbar-group">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(input) => {
              if (input) input.indeterminate = someSelected && !allSelected
            }}
            onChange={(e) => onSelectAll(e.target.checked)}
            aria-label="Select all threads"
          />
          {selectedList.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => onArchive(selectedList)}
                aria-label="Archive selected"
                title="Archive (e)"
              >
                📥 Archive
              </button>
              <button
                type="button"
                onClick={() => onTrash(selectedList)}
                aria-label="Delete selected"
                title="Delete (#)"
              >
                🗑️ Trash
              </button>
              <button
                type="button"
                onClick={() => onMarkRead(selectedList, true)}
                aria-label="Mark selected as read"
              >
                ✉️ Read
              </button>
              <button
                type="button"
                onClick={() => onMarkRead(selectedList, false)}
                aria-label="Mark selected as unread"
              >
                📩 Unread
              </button>
              <button
                type="button"
                onClick={() => onSpam(selectedList)}
                aria-label="Report selected as spam"
              >
                🚫 Spam
              </button>
            </>
          )}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--navin-text-muted)' }}>
          {threads.length} thread{threads.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Threads */}
      {threads.length === 0 ? (
        <div
          style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--navin-text-muted)' }}
        >
          No messages found.
        </div>
      ) : (
        <ul className="mail-thread-list" role="listbox" aria-label="Thread list">
          {threads.map((thread, index) => {
            const isSelected = selectedThreadIds.has(thread.id)
            const isActive = activeThreadId === thread.id
            const isFocused = index === focusedIndex
            const participantsText = thread.participants
              .map((p) => p.name || p.address.split('@')[0])
              .join(', ')

            return (
              <li
                key={thread.id}
                role="option"
                aria-selected={isSelected}
                tabIndex={isFocused ? 0 : -1}
                className={`mail-thread-row ${thread.unreadCount > 0 ? 'unread' : ''} ${
                  isSelected ? 'selected' : ''
                } ${isFocused ? 'focused' : ''} ${isActive ? 'active' : ''}`}
                onClick={() => onSelectThread(thread)}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => {
                    e.stopPropagation()
                    onToggleSelect(thread.id)
                  }}
                  aria-label={`Select thread ${thread.subject}`}
                />
                <button
                  type="button"
                  className={`mail-thread-star ${thread.isStarred ? 'starred' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onStarToggle(thread.id, !thread.isStarred)
                  }}
                  aria-label={thread.isStarred ? 'Unstar thread' : 'Star thread'}
                >
                  {thread.isStarred ? '★' : '☆'}
                </button>
                <div className="mail-thread-participants" title={participantsText}>
                  {participantsText} {thread.messageCount > 1 ? `(${thread.messageCount})` : ''}
                </div>
                <div className="mail-thread-content">
                  <span className="mail-thread-subject">{thread.subject}</span>
                  <span className="mail-thread-snippet">— {thread.snippet}</span>
                </div>
                {thread.hasAttachment && <span title="Has attachment">📎</span>}
                <div className="mail-thread-date">
                  {new Date(thread.latestReceivedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
