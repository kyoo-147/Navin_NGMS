import React, { useState, useEffect } from 'react'
import type { DraftRecord } from '@navin/mail-store'
import type { MailAttachment } from '@navin/contracts'
import { validateDraftRecipients, detectMissingAttachmentWarning } from '@navin/mail-core'

export interface ComposeModalProps {
  draft: DraftRecord
  onClose: () => void
  onSaveDraft: (draft: DraftRecord) => void
  onSend: (draft: DraftRecord, scheduleSendAt?: string) => void
  availableSenderIdentities?: string[]
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  draft: initialDraft,
  onClose,
  onSaveDraft,
  onSend,
  availableSenderIdentities = ['alice@example.com', 'bob@example.com'],
}) => {
  const [draft, setDraft] = useState<DraftRecord>(initialDraft)
  const [toInput, setToInput] = useState(draft.to.map((r) => r.address).join(', '))
  const [ccInput, setCcInput] = useState(draft.cc.map((r) => r.address).join(', '))
  const [showCc, setShowCc] = useState(draft.cc.length > 0)
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduledAt, setScheduledAt] = useState<string>('')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const [promptMissingAttachment, setPromptMissingAttachment] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Sync draft prop changes into state
  useEffect(() => {
    setDraft(initialDraft)
    setToInput(initialDraft.to.map((r) => r.address).join(', '))
    setCcInput(initialDraft.cc.map((r) => r.address).join(', '))
    setShowCc(initialDraft.cc.length > 0)
  }, [initialDraft])

  // Debounced autosave
  useEffect(() => {
    setSaveStatus('saving')
    const timer = setTimeout(() => {
      onSaveDraft(draft)
      setSaveStatus('saved')
    }, 1000)
    return () => clearTimeout(timer)
  }, [draft, onSaveDraft])

  const handleToChange = (val: string) => {
    setToInput(val)
    const addrs = val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft((prev) => ({
      ...prev,
      to: addrs.map((a) => ({ address: a })),
      updatedAt: new Date().toISOString(),
    }))
  }

  const handleCcChange = (val: string) => {
    setCcInput(val)
    const addrs = val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft((prev) => ({
      ...prev,
      cc: addrs.map((a) => ({ address: a })),
      updatedAt: new Date().toISOString(),
    }))
  }

  const handleAddAttachment = () => {
    // Simulated attachment file picker
    const sampleAttachment: MailAttachment = {
      filename: `document_${draft.attachments.length + 1}.pdf`,
      mimeType: 'application/pdf',
      size: 1024 * 150,
      blobId: `blob-${Date.now()}`,
    }
    setDraft((prev) => ({
      ...prev,
      attachments: [...prev.attachments, sampleAttachment],
      updatedAt: new Date().toISOString(),
    }))
  }

  const handleRemoveAttachment = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== idx),
      updatedAt: new Date().toISOString(),
    }))
  }

  const handleSendClick = () => {
    setErrorMsg(null)
    const validation = validateDraftRecipients(draft)
    if (!validation.valid) {
      setErrorMsg(validation.errors.join('; '))
      return
    }

    if (detectMissingAttachmentWarning(draft) && !promptMissingAttachment) {
      setPromptMissingAttachment(true)
      return
    }

    onSend(draft, showSchedule && scheduledAt ? new Date(scheduledAt).toISOString() : undefined)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Compose Message"
      className="mail-compose-dialog"
    >
      <div className="mail-compose-header">
        <span>New Message</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--navin-text-muted)' }}>
            {saveStatus === 'saving' ? 'Saving draft...' : 'Saved'}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close compose modal"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mail-compose-body">
        {errorMsg && (
          <div role="alert" className="mail-security-banner danger" style={{ margin: 0 }}>
            {errorMsg}
          </div>
        )}

        {promptMissingAttachment && (
          <div role="alert" className="mail-security-banner warning" style={{ margin: 0 }}>
            <span>
              ⚠️ Did you forget to attach a file? You mentioned an attachment in your message.
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={handleAddAttachment}
                style={{ padding: '2px 8px', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Attach File
              </button>
              <button
                type="button"
                onClick={() => {
                  setPromptMissingAttachment(false)
                  onSend(
                    draft,
                    showSchedule && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
                  )
                }}
                style={{ padding: '2px 8px', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Send Anyway
              </button>
            </div>
          </div>
        )}

        {/* Sender Identity */}
        <div className="mail-compose-row">
          <label htmlFor="compose-from">From:</label>
          <select
            id="compose-from"
            value={draft.senderIdentityId}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                senderIdentityId: e.target.value,
                updatedAt: new Date().toISOString(),
              }))
            }
          >
            {availableSenderIdentities.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>

        {/* To */}
        <div className="mail-compose-row">
          <label htmlFor="compose-to">To:</label>
          <input
            id="compose-to"
            type="text"
            placeholder="Recipients (comma separated)"
            value={toInput}
            onChange={(e) => handleToChange(e.target.value)}
          />
          {!showCc && (
            <button
              type="button"
              onClick={() => setShowCc(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#0284c7',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Cc
            </button>
          )}
        </div>

        {/* Cc */}
        {showCc && (
          <div className="mail-compose-row">
            <label htmlFor="compose-cc">Cc:</label>
            <input
              id="compose-cc"
              type="text"
              placeholder="Cc recipients"
              value={ccInput}
              onChange={(e) => handleCcChange(e.target.value)}
            />
          </div>
        )}

        {/* Subject */}
        <div className="mail-compose-row">
          <label htmlFor="compose-subject">Subject:</label>
          <input
            id="compose-subject"
            type="text"
            placeholder="Subject"
            value={draft.subject}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                subject: e.target.value,
                updatedAt: new Date().toISOString(),
              }))
            }
          />
        </div>

        {/* Body */}
        <textarea
          aria-label="Message Body"
          className="mail-compose-textarea"
          placeholder="Compose your email here..."
          value={draft.bodyText}
          onChange={(e) =>
            setDraft((prev) => ({
              ...prev,
              bodyText: e.target.value,
              bodyHtml: `<p>${e.target.value.replace(/\n/g, '<br>')}</p>`,
              updatedAt: new Date().toISOString(),
            }))
          }
        />

        {/* Attachments */}
        {draft.attachments.length > 0 && (
          <div
            className="mail-attachments-list"
            style={{ border: '1px solid var(--navin-border)', borderRadius: '4px' }}
          >
            {draft.attachments.map((att, idx) => (
              <div key={idx} className="mail-attachment-chip">
                <span>📎 {att.filename}</span>
                <span style={{ color: 'var(--navin-text-muted)' }}>
                  ({(att.size / 1024).toFixed(0)} KB)
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(idx)}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    color: '#ef4444',
                  }}
                  aria-label={`Remove attachment ${att.filename}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Scheduled Send options */}
        {showSchedule && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 0',
              fontSize: '0.85rem',
            }}
          >
            <label htmlFor="schedule-time">Send at:</label>
            <input
              id="schedule-time"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mail-compose-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="mail-compose-btn"
            style={{ margin: 0, padding: '8px 16px' }}
            onClick={handleSendClick}
            aria-label="Send email"
          >
            {showSchedule ? 'Schedule Send' : 'Send'}
          </button>
          <button
            type="button"
            onClick={() => setShowSchedule((prev) => !prev)}
            title="Schedule send for later"
            aria-label="Toggle scheduled send"
            style={{
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid var(--navin-border)',
              background: 'var(--navin-surface)',
              cursor: 'pointer',
            }}
          >
            ⏰
          </button>
          <button
            type="button"
            onClick={handleAddAttachment}
            title="Attach file"
            aria-label="Attach file"
            style={{
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid var(--navin-border)',
              background: 'var(--navin-surface)',
              cursor: 'pointer',
            }}
          >
            📎
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Discard draft"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--navin-text-muted)',
            fontSize: '0.85rem',
          }}
        >
          🗑️ Discard
        </button>
      </div>
    </div>
  )
}
