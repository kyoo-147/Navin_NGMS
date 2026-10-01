import React, { useState, useEffect } from 'react'
import type { SetupBlock, SetupSession } from '@navin/contracts'
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  StatusBadge,
  type StatusTone,
} from '@navin/ui-primitives'
import { ActiveBlockView } from './ActiveBlockView.js'
import { EvidencePanel } from './EvidencePanel.js'
import { StageNavigation } from './StageNavigation.js'

export interface SetupApiClient {
  getSetupSession(id: string): Promise<SetupSession>
  listSetupSessions(): Promise<SetupSession[]>
  createSetupSession(input: {
    title: string
    intelligenceMode?: string
    targetHost?: unknown
    destructive?: boolean
  }): Promise<SetupSession>
  resumeSetupSession(id: string): Promise<SetupSession>
  runSetupCommand(
    id: string,
    command: string,
    options?: { confirmation?: string; force?: boolean },
  ): Promise<SetupSession>
}

export interface SetupAppProps {
  client: SetupApiClient
  initialSessionId?: string
}

export function SetupApp({ client, initialSessionId }: SetupAppProps): React.JSX.Element {
  const [session, setSession] = useState<SetupSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isActionRunning, setIsActionRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Creation form state for empty state
  const [newTitle, setNewTitle] = useState('Production Mailnode Setup')
  const [isDestructive, setIsDestructive] = useState(false)

  const loadSession = async (id: string) => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const data = await client.getSetupSession(id)
      setSession(data)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  const loadInitial = async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      if (initialSessionId) {
        await loadSession(initialSessionId)
        return
      }
      const list = await client.listSetupSessions()
      if (list.length > 0 && list[0]) {
        setSession(list[0])
      } else {
        setSession(null)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadInitial()
  }, [initialSessionId])

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const created = await client.createSetupSession({
        title: newTitle.trim() || 'Production Setup',
        targetHost: { kind: 'local' },
        destructive: isDestructive,
      })
      setSession(created)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  const handleRunCommand = async (command: string, confirmation?: string) => {
    if (!session) return
    setIsActionRunning(true)
    setErrorMessage(null)
    try {
      const updated = await client.runSetupCommand(session.id, command, { confirmation })
      setSession(updated)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsActionRunning(false)
    }
  }

  const handleResume = async () => {
    if (!session) return
    setIsActionRunning(true)
    setErrorMessage(null)
    try {
      const resumed = await client.resumeSetupSession(session.id)
      setSession(resumed)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsActionRunning(false)
    }
  }

  // 1. Loading State
  if (isLoading) {
    return (
      <div
        className="setup-loading-state"
        style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}
      >
        <h1 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Navin Control Setup</h1>
        <Skeleton variant="rect" height={40} style={{ marginBottom: '16px' }} />
        <Skeleton variant="rect" height={180} style={{ marginBottom: '16px' }} />
        <Skeleton variant="rect" height={120} />
      </div>
    )
  }

  // 2. Error State
  if (errorMessage && !session) {
    return (
      <div
        className="setup-error-state"
        style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}
      >
        <ErrorState
          title="Setup Connection Error"
          description={errorMessage}
          action={
            <Button variant="primary" onClick={loadInitial}>
              Retry Connection
            </Button>
          }
        />
      </div>
    )
  }

  // 3. Empty State
  if (!session) {
    return (
      <div
        className="setup-empty-state"
        style={{ padding: '24px', maxWidth: '600px', margin: '0 auto' }}
      >
        <EmptyState
          title="No Setup Session Active"
          description="Begin a new setup journey to discover, configure, approve, and verify this Navin node."
        />
        <form
          onSubmit={handleCreateSession}
          style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <Input
            label="Setup Session Title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="e.g. Primary Mail Server"
            required
          />
          <Checkbox
            label="Enable Tier 3 Destructive Cutover Mode"
            checked={isDestructive}
            onChange={(e) => setIsDestructive(e.target.checked)}
          />
          <Button variant="primary" type="submit">
            Start Setup Session
          </Button>
        </form>
      </div>
    )
  }

  // Active Session View
  const completedStages = session.blocks.filter((b) => b.status === 'passed').map((b) => b.stage)

  // Find active block: first non-passed block, or last block if completed
  const activeBlock: SetupBlock =
    session.blocks.find((b) => b.status !== 'passed') || session.blocks[session.blocks.length - 1]!

  const sessionStatusTone: StatusTone =
    session.status === 'completed' ? 'success' : session.status === 'failed' ? 'danger' : 'info'

  return (
    <main
      className="setup-app-shell"
      style={{
        padding: '24px',
        maxWidth: '1100px',
        margin: '0 auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '16px',
        }}
      >
        <div>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '1.6rem' }}>{session.title}</h1>
          <div style={{ color: '#666', fontSize: '0.85rem', fontFamily: 'monospace' }}>
            ID: {session.id} • Cursor: {session.eventCursor || '0'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button variant="secondary" onClick={handleResume} disabled={isActionRunning}>
            Resume Setup
          </Button>
          <StatusBadge tone={sessionStatusTone}>{session.status}</StatusBadge>
        </div>
      </header>

      {/* Inline Error Banner */}
      {errorMessage && (
        <div style={{ marginBottom: '16px' }}>
          <ErrorState
            title="Operation Blocked or Failed"
            description={errorMessage}
            action={
              <Button variant="secondary" onClick={() => setErrorMessage(null)}>
                Dismiss
              </Button>
            }
          />
        </div>
      )}

      {/* Stage Navigation */}
      <StageNavigation currentStage={session.currentStage} completedStages={completedStages} />

      {/* Main Grid: Active Block View + Evidence Panel */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginTop: '20px' }}
      >
        <ActiveBlockView
          session={session}
          block={activeBlock}
          isLoading={isActionRunning}
          onRunCommand={handleRunCommand}
        />
        <EvidencePanel blocks={session.blocks} />
      </div>
    </main>
  )
}
