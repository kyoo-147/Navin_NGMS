import React from 'react'

export interface StatusBadgeProps {
  online: boolean
  syncing?: boolean
  pendingOutboxCount?: number
  conflictCount?: number
  onViewConflicts?: () => void
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  online,
  syncing = false,
  pendingOutboxCount = 0,
  conflictCount = 0,
  onViewConflicts,
}) => {
  return (
    <div
      className="mail-status-group"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem' }}
    >
      <span
        role="status"
        aria-label={
          online ? (syncing ? 'Syncing mail' : 'Online') : 'Offline (Local changes queued)'
        }
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: '2px 8px',
          borderRadius: '12px',
          fontWeight: 600,
          backgroundColor: online ? (syncing ? '#e0f2fe' : '#dcfce7') : '#fee2e2',
          color: online ? (syncing ? '#0369a1' : '#15803d') : '#b91c1c',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: online ? (syncing ? '#0284c7' : '#22c55e') : '#ef4444',
          }}
        />
        {online ? (syncing ? 'Syncing...' : 'Online') : 'Offline'}
      </span>

      {pendingOutboxCount > 0 && (
        <span
          title={`${pendingOutboxCount} items queued in durable offline outbox`}
          style={{
            padding: '2px 6px',
            borderRadius: '10px',
            backgroundColor: '#f1f5f9',
            color: '#475569',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          {pendingOutboxCount} queued
        </span>
      )}

      {conflictCount > 0 && (
        <button
          type="button"
          onClick={onViewConflicts}
          style={{
            padding: '2px 8px',
            borderRadius: '10px',
            backgroundColor: '#fef3c7',
            color: '#b45309',
            border: '1px solid #f59e0b',
            fontSize: '0.75rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          aria-label={`${conflictCount} sync conflicts need attention`}
        >
          ⚠️ {conflictCount} Attention Needed
        </button>
      )}
    </div>
  )
}
