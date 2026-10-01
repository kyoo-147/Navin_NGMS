import React, { useState } from 'react'
import type { SetupBlock, SetupSession } from '@navin/contracts'
import { Button, Input, StatusBadge, type StatusTone } from '@navin/ui-primitives'

export interface ActiveBlockViewProps {
  session: SetupSession
  block: SetupBlock
  isLoading: boolean
  onRunCommand: (command: string, confirmation?: string) => Promise<void>
}

export function ActiveBlockView({
  session,
  block,
  isLoading,
  onRunCommand,
}: ActiveBlockViewProps): React.JSX.Element {
  const [confirmationInput, setConfirmationInput] = useState('')

  const statusTone: StatusTone =
    block.status === 'passed'
      ? 'success'
      : block.status === 'running'
        ? 'info'
        : block.status === 'failed'
          ? 'danger'
          : block.status === 'warning'
            ? 'warning'
            : 'neutral'

  const commandForKind: Record<string, string> = {
    discovery: 'discover',
    plan: 'plan',
    diff: 'diff',
    approval: 'approve',
    action: 'apply',
    verification: 'verify',
  }

  const currentCommand = commandForKind[block.kind] || 'discover'
  const isDestructive = block.risk === 'destructive'
  const expectedPhrase = `confirm ${session.id}`
  const isConfirmationValid = !isDestructive || confirmationInput.trim() === expectedPhrase

  const canExecute = !isLoading && block.status !== 'passed' && isConfirmationValid

  const handleAction = async () => {
    if (!canExecute) return
    await onRunCommand(currentCommand, isDestructive ? confirmationInput.trim() : undefined)
    setConfirmationInput('')
  }

  const blockOutput = (block.value as { output?: unknown } | undefined)?.output

  return (
    <section
      className="setup-active-block"
      style={{
        padding: '16px',
        border: '1px solid #ddd',
        borderRadius: '8px',
        background: '#fafafa',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '1.25rem' }}>{block.title}</h2>
          <p style={{ margin: 0, color: '#555', fontSize: '0.9rem' }}>{block.summary}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {block.risk && (
            <StatusBadge tone={block.risk === 'destructive' ? 'danger' : 'neutral'}>
              Risk: {block.risk}
            </StatusBadge>
          )}
          <StatusBadge tone={statusTone}>{block.status}</StatusBadge>
        </div>
      </header>

      {/* Long-data / Diff display container */}
      {Boolean(blockOutput) && (
        <div style={{ margin: '16px 0' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '6px' }}>
            {block.kind === 'diff' ? 'Exact Diff Preview' : 'Recorded Output'}
          </h3>
          <div
            className="long-data-container"
            style={{
              maxHeight: '260px',
              overflowY: 'auto',
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: '4px',
              padding: '12px',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
            }}
          >
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(blockOutput, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Tier 3 Fail-Closed Confirmation Box */}
      {isDestructive && block.status !== 'passed' && (
        <div
          className="tier3-confirmation-box"
          style={{
            margin: '16px 0',
            padding: '12px',
            background: '#fff3cd',
            border: '1px solid #ffeeba',
            borderRadius: '4px',
          }}
        >
          <strong style={{ color: '#856404', display: 'block', marginBottom: '6px' }}>
            ▲ Tier 3 Destructive Operation
          </strong>
          <p style={{ margin: '0 0 8px 0', fontSize: '0.875rem' }}>
            To approve or apply this destructive change, you must type the exact confirmation
            phrase:{' '}
            <code style={{ background: '#eee', padding: '2px 4px', borderRadius: '3px' }}>
              {expectedPhrase}
            </code>
          </p>
          <Input
            label="Confirmation Phrase"
            value={confirmationInput}
            onChange={(e) => setConfirmationInput(e.target.value)}
            placeholder={expectedPhrase}
            disabled={isLoading}
          />
        </div>
      )}

      <footer style={{ marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <Button
          variant={isDestructive ? 'danger' : 'primary'}
          onClick={handleAction}
          disabled={!canExecute}
        >
          {isLoading
            ? 'Executing...'
            : block.status === 'passed'
              ? 'Completed'
              : `Run ${currentCommand}`}
        </Button>
      </footer>
    </section>
  )
}
