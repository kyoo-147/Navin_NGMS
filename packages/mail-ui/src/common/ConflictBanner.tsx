import React from 'react'
import type { ConflictRecord } from '@navin/mail-store'

export interface ConflictBannerProps {
  conflicts: ConflictRecord[]
  onResolve?: (conflictId: string) => void
  onRetryAll?: () => void
}

export const ConflictBanner: React.FC<ConflictBannerProps> = ({
  conflicts,
  onResolve,
  onRetryAll,
}) => {
  if (conflicts.length === 0) return null

  return (
    <div
      role="alert"
      className="mail-security-banner warning"
      style={{ margin: '8px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <div>
          <strong>Sync Attention Needed:</strong> {conflicts.length} item(s) could not be dispatched
          to the server.
        </div>
        {onRetryAll && (
          <button
            type="button"
            onClick={onRetryAll}
            style={{
              padding: '4px 10px',
              backgroundColor: '#f59e0b',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry All
          </button>
        )}
      </div>

      <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.8rem' }}>
        {conflicts.map((c) => (
          <li
            key={c.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <span>
              <strong>{c.reason}:</strong> {c.detail}
            </span>
            {onResolve && (
              <button
                type="button"
                onClick={() => onResolve(c.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#b45309',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                Dismiss
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
