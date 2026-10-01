import React from 'react'
import type { SetupBlock } from '@navin/contracts'
import { StatusBadge, type StatusTone } from '@navin/ui-primitives'

export interface EvidenceRecord {
  id: string
  status: 'passed' | 'warning' | 'failed'
  kind: string
  details: Record<string, unknown>
  observedAt: string
  checksum: string
}

export interface EvidencePanelProps {
  blocks: SetupBlock[]
}

export function EvidencePanel({ blocks }: EvidencePanelProps): React.JSX.Element {
  const allEvidence: { blockTitle: string; evidence: EvidenceRecord }[] = []

  for (const block of blocks) {
    const metadata = (block as { metadata?: { evidence?: EvidenceRecord[] } }).metadata
    if (metadata?.evidence) {
      for (const item of metadata.evidence) {
        allEvidence.push({ blockTitle: block.title, evidence: item })
      }
    }
  }

  if (allEvidence.length === 0) {
    return (
      <aside
        className="evidence-panel"
        style={{
          padding: '16px',
          background: '#f5f5f5',
          borderRadius: '8px',
          border: '1px solid #e0e0e0',
        }}
      >
        <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>Evidence & Audit</h3>
        <p style={{ margin: 0, color: '#666', fontSize: '0.875rem' }}>
          No evidence records collected yet.
        </p>
      </aside>
    )
  }

  return (
    <aside
      className="evidence-panel long-data-container"
      style={{
        padding: '16px',
        background: '#f5f5f5',
        borderRadius: '8px',
        border: '1px solid #e0e0e0',
        maxHeight: '400px',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>
        Authoritative Evidence ({allEvidence.length})
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {allEvidence.map(({ blockTitle, evidence }) => {
          const tone: StatusTone =
            evidence.status === 'passed'
              ? 'success'
              : evidence.status === 'warning'
                ? 'warning'
                : 'danger'

          return (
            <div
              key={evidence.id}
              style={{
                padding: '10px',
                background: '#fff',
                border: '1px solid #d0d0d0',
                borderRadius: '6px',
                fontSize: '0.85rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <span style={{ fontWeight: 600 }}>{evidence.kind}</span>
                <StatusBadge tone={tone}>{evidence.status}</StatusBadge>
              </div>
              <div style={{ color: '#555', marginBottom: '4px' }}>Block: {blockTitle}</div>
              <div style={{ color: '#777', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                ID: {evidence.id}
              </div>
              <div style={{ color: '#777', fontSize: '0.75rem' }}>
                Observed: {evidence.observedAt}
              </div>
              <details style={{ marginTop: '6px' }}>
                <summary style={{ cursor: 'pointer', color: '#005fb8' }}>
                  Details & Checksum
                </summary>
                <div style={{ marginTop: '4px', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                  <div>Checksum: {evidence.checksum}</div>
                  <pre
                    style={{
                      margin: '4px 0 0 0',
                      background: '#f8f8f8',
                      padding: '6px',
                      borderRadius: '4px',
                      overflowX: 'auto',
                    }}
                  >
                    {JSON.stringify(evidence.details, null, 2)}
                  </pre>
                </div>
              </details>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
