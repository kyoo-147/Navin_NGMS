import React from 'react'
import type { CapabilityNotice } from '@navin/mail-core'

export interface UnsupportedCapabilityBannerProps {
  notices: CapabilityNotice[]
}

export const UnsupportedCapabilityBanner: React.FC<UnsupportedCapabilityBannerProps> = ({
  notices,
}) => {
  const unsupported = notices.filter((n) => !n.supported)
  if (unsupported.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Server Capability Notices"
      style={{
        padding: '8px 16px',
        backgroundColor: '#f8fafc',
        borderBottom: '1px solid #e2e8f0',
        fontSize: '0.8rem',
        color: '#64748b',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'center',
      }}
    >
      <span style={{ fontWeight: 600, color: '#334155' }}>Server Capabilities:</span>
      {unsupported.map((n) => (
        <span
          key={n.capability}
          title={n.description}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            backgroundColor: '#f1f5f9',
            padding: '2px 8px',
            borderRadius: '4px',
            border: '1px solid #cbd5e1',
          }}
        >
          <span>ℹ️</span>
          <span>
            {n.title}: {n.fallbackAvailable ? 'Client outbox fallback' : 'Unsupported'}
          </span>
        </span>
      ))}
    </div>
  )
}
