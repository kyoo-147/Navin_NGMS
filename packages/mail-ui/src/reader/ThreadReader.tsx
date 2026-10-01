import React, { useState } from 'react'
import type { NormalizedEmail } from '@navin/mail-gateway'
import {
  extractAuthenticationHeaders,
  extractUnsubscribeInfo,
  exportEml,
  type ThreadSummary,
} from '@navin/mail-core'
import { SecureHtmlViewer } from './SecureHtmlViewer.js'

export interface ThreadReaderProps {
  thread: ThreadSummary
  onBack?: () => void
  onReply: (email: NormalizedEmail, replyAll: boolean) => void
  onForward: (email: NormalizedEmail) => void
  onTrashThread: (threadId: string) => void
  onRsvp?: (email: NormalizedEmail, status: 'accepted' | 'declined' | 'tentative') => void
}

export const ThreadReader: React.FC<ThreadReaderProps> = ({
  thread,
  onBack,
  onReply,
  onForward,
  onTrashThread,
  onRsvp,
}) => {
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => {
    // Expand the last message by default
    const last = thread.messages[thread.messages.length - 1]
    return new Set(last ? [last.id] : [])
  })
  const [viewingRawHeaderMsgId, setViewingRawHeaderMsgId] = useState<string | null>(null)

  const toggleExpand = (id: string) => {
    setExpandedMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleExportEml = (email: NormalizedEmail) => {
    const emlContent = exportEml(email)
    const blob = new Blob([emlContent], { type: 'message/rfc822' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${email.subject || 'message'}.eml`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mail-thread-reader" role="region" aria-label={`Thread: ${thread.subject}`}>
      {/* Header */}
      <div className="mail-reader-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to thread list"
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '1.2rem',
              }}
            >
              ←
            </button>
          )}
          <h2 className="mail-reader-subject">{thread.subject}</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => onTrashThread(thread.id)}
            title="Delete thread"
            aria-label="Delete thread"
          >
            🗑️ Delete
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            title="Print thread"
            aria-label="Print thread"
          >
            🖨️ Print
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {thread.messages.map((msg) => {
          const isExpanded = expandedMessageIds.has(msg.id)
          const rawHeaders =
            ((msg as unknown as Record<string, unknown>).headers as Record<
              string,
              string | string[]
            >) ?? {}
          const authStatus = extractAuthenticationHeaders(rawHeaders)
          const unsubInfo = extractUnsubscribeInfo(rawHeaders)
          const sender = msg.from[0] ?? { address: 'unknown@example.invalid' }
          const hasCalendarInvite = msg.attachments.some(
            (a) => a.filename.endsWith('.ics') || a.mimeType.includes('calendar'),
          )

          return (
            <article
              key={msg.id}
              className="mail-message-card"
              aria-expanded={isExpanded}
              aria-label={`Message from ${sender.name || sender.address}`}
            >
              {/* Card Header */}
              <div
                className="mail-message-card-header"
                onClick={() => toggleExpand(msg.id)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong>{sender.name || sender.address}</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--navin-text-muted)' }}>
                    &lt;{sender.address}&gt;
                  </span>
                  {/* Auth badges */}
                  {authStatus.dkim === 'pass' && (
                    <span
                      title="DKIM Verified"
                      style={{
                        fontSize: '0.7rem',
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                        padding: '1px 5px',
                        borderRadius: '4px',
                      }}
                    >
                      ✓ DKIM
                    </span>
                  )}
                  {authStatus.spf === 'pass' && (
                    <span
                      title="SPF Verified"
                      style={{
                        fontSize: '0.7rem',
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                        padding: '1px 5px',
                        borderRadius: '4px',
                      }}
                    >
                      ✓ SPF
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {unsubInfo && (
                    <a
                      href={
                        unsubInfo.url || (unsubInfo.mailto ? `mailto:${unsubInfo.mailto}` : '#')
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: '0.75rem', color: '#0284c7' }}
                    >
                      Unsubscribe
                    </a>
                  )}
                  <span style={{ fontSize: '0.8rem', color: 'var(--navin-text-muted)' }}>
                    {new Date(msg.receivedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Expanded Card Body */}
              {isExpanded && (
                <div className="mail-message-body">
                  <div
                    style={{
                      marginBottom: '12px',
                      fontSize: '0.8rem',
                      color: 'var(--navin-text-muted)',
                    }}
                  >
                    To: {msg.to.map((t) => t.name || t.address).join(', ')}
                    {msg.cc.length > 0 &&
                      ` | Cc: ${msg.cc.map((c) => c.name || c.address).join(', ')}`}
                  </div>

                  <SecureHtmlViewer
                    html={msg.bodyHtml}
                    plainTextFallback={msg.bodyText}
                    attachments={msg.attachments}
                  />

                  {/* Attachments */}
                  {msg.attachments.length > 0 && (
                    <div className="mail-attachments-list">
                      {msg.attachments.map((att, attIdx) => (
                        <div key={attIdx} className="mail-attachment-chip">
                          <span>📎</span>
                          <span>{att.filename}</span>
                          <span style={{ color: 'var(--navin-text-muted)' }}>
                            ({(att.size / 1024).toFixed(0)} KB)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: '16px',
                      paddingTop: '12px',
                      borderTop: '1px solid var(--navin-border)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => onReply(msg, false)}
                        aria-label="Reply to sender"
                      >
                        ↩ Reply
                      </button>
                      <button
                        type="button"
                        onClick={() => onReply(msg, true)}
                        aria-label="Reply to all recipients"
                      >
                        👥 Reply All
                      </button>
                      <button
                        type="button"
                        onClick={() => onForward(msg)}
                        aria-label="Forward message"
                      >
                        ↪ Forward
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => handleExportEml(msg)}
                        style={{
                          fontSize: '0.8rem',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--navin-text-muted)',
                        }}
                      >
                        ⬇ Export EML
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setViewingRawHeaderMsgId((prev) => (prev === msg.id ? null : msg.id))
                        }
                        style={{
                          fontSize: '0.8rem',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--navin-text-muted)',
                        }}
                      >
                        {viewingRawHeaderMsgId === msg.id ? 'Hide Headers' : 'View Headers'}
                      </button>
                    </div>
                  </div>

                  {/* Calendar invite RSVP bar */}
                  {hasCalendarInvite && onRsvp && (
                    <div
                      style={{
                        marginTop: '12px',
                        padding: '10px 14px',
                        backgroundColor: '#e0f2fe',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        📅 <strong>Calendar Invitation:</strong> Respond to event invite
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => onRsvp(msg, 'accepted')}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: '#22c55e',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => onRsvp(msg, 'tentative')}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: '#f59e0b',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          Maybe
                        </button>
                        <button
                          type="button"
                          onClick={() => onRsvp(msg, 'declined')}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: '#ef4444',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Raw headers display */}
                  {viewingRawHeaderMsgId === msg.id && (
                    <pre
                      style={{
                        marginTop: '12px',
                        padding: '10px',
                        backgroundColor: '#f1f5f9',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        overflowX: 'auto',
                      }}
                    >
                      {JSON.stringify(rawHeaders, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
