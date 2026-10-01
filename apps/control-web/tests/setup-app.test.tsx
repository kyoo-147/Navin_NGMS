import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { SetupSession, SetupBlock } from '@navin/contracts'
import { SetupApp, type SetupApiClient } from '../src/components/SetupApp.js'

function createSampleSession(overrides: Partial<SetupSession> = {}): SetupSession {
  const blocks: SetupBlock[] = [
    {
      id: 'blk_disc_1',
      sessionId: 'set_sample_123',
      schemaVersion: '1.0.0',
      stage: 'DISCOVER',
      kind: 'discovery',
      title: 'Environment Discovery',
      summary: 'Discover system resources and network connectivity',
      status: 'passed',
      risk: 'read',
      canRetry: true,
      canRollback: false,
      dependencies: [],
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:01:00.000Z',
      evidenceIds: ['evi_disc_1'],
      // @ts-expect-error test mock metadata
      metadata: {
        evidence: [
          {
            id: 'evi_disc_1',
            status: 'passed',
            kind: 'discovery_record',
            details: { os: 'linux', port25: 'available' },
            observedAt: '2026-10-01T12:00:00.000Z',
            checksum: 'chk_123456',
          },
        ],
      },
    },
    {
      id: 'blk_plan_1',
      sessionId: 'set_sample_123',
      schemaVersion: '1.0.0',
      stage: 'PLAN',
      kind: 'plan',
      title: 'Execution Planning',
      summary: 'Generate deployment plan',
      status: 'passed',
      risk: 'staged',
      canRetry: true,
      canRollback: false,
      dependencies: ['blk_disc_1'],
      createdAt: '2026-10-01T12:01:00.000Z',
      updatedAt: '2026-10-01T12:02:00.000Z',
      evidenceIds: [],
    },
    {
      id: 'blk_diff_1',
      sessionId: 'set_sample_123',
      schemaVersion: '1.0.0',
      stage: 'PLAN',
      kind: 'diff',
      title: 'Configuration Diff',
      summary: 'Review diff before mutation',
      status: 'passed',
      risk: 'shared',
      canRetry: true,
      canRollback: false,
      dependencies: ['blk_plan_1'],
      createdAt: '2026-10-01T12:02:00.000Z',
      updatedAt: '2026-10-01T12:03:00.000Z',
      evidenceIds: [],
    },
    {
      id: 'blk_appr_1',
      sessionId: 'set_sample_123',
      schemaVersion: '1.0.0',
      stage: 'APPROVAL',
      kind: 'approval',
      title: 'Admin Approval',
      summary: 'Confirm destructive cutover approval',
      status: 'pending',
      risk: 'destructive',
      canRetry: false,
      canRollback: false,
      dependencies: ['blk_diff_1'],
      createdAt: '2026-10-01T12:03:00.000Z',
      updatedAt: '2026-10-01T12:04:00.000Z',
      evidenceIds: [],
    },
    {
      id: 'blk_apply_1',
      sessionId: 'set_sample_123',
      schemaVersion: '1.0.0',
      stage: 'APPLY',
      kind: 'action',
      title: 'Apply Configuration',
      summary: 'Execute loopback mutation',
      status: 'pending',
      risk: 'destructive',
      canRetry: true,
      canRollback: true,
      dependencies: ['blk_appr_1'],
      createdAt: '2026-10-01T12:04:00.000Z',
      updatedAt: '2026-10-01T12:05:00.000Z',
      evidenceIds: [],
    },
    {
      id: 'blk_ver_1',
      sessionId: 'set_sample_123',
      schemaVersion: '1.0.0',
      stage: 'VERIFY_INFRA',
      kind: 'verification',
      title: 'Health Verification',
      summary: 'Verify running mail service',
      status: 'pending',
      risk: 'read',
      canRetry: true,
      canRollback: false,
      dependencies: ['blk_apply_1'],
      createdAt: '2026-10-01T12:05:00.000Z',
      updatedAt: '2026-10-01T12:05:00.000Z',
      evidenceIds: [],
    },
  ]

  return {
    id: 'set_sample_123',
    title: 'Sample Mailnode Setup',
    intelligenceMode: 'none',
    status: 'active',
    currentStage: 'APPROVAL',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:05:00.000Z',
    blocks,
    eventCursor: 'evt_003',
    ...overrides,
  }
}

describe('SetupApp Web Component', () => {
  it('renders empty state when no sessions exist', async () => {
    const mockClient: SetupApiClient = {
      getSetupSession: vi.fn(),
      listSetupSessions: vi.fn().mockResolvedValue([]),
      createSetupSession: vi.fn(),
      resumeSetupSession: vi.fn(),
      runSetupCommand: vi.fn(),
    }

    render(<SetupApp client={mockClient} />)

    expect(await screen.findByText('No Setup Session Active')).toBeDefined()
    expect(screen.getByText('Start Setup Session')).toBeDefined()
  })

  it('renders error state when client fails to load', async () => {
    const mockClient: SetupApiClient = {
      getSetupSession: vi.fn().mockRejectedValue(new Error('Network connection timeout')),
      listSetupSessions: vi.fn(),
      createSetupSession: vi.fn(),
      resumeSetupSession: vi.fn(),
      runSetupCommand: vi.fn(),
    }

    render(<SetupApp client={mockClient} initialSessionId="set_err" />)

    expect(await screen.findByText('Setup Connection Error')).toBeDefined()
    expect(screen.getByText('Network connection timeout')).toBeDefined()
    expect(screen.getByText('Retry Connection')).toBeDefined()
  })

  it('renders active session, stage navigation, and evidence panel', async () => {
    const sample = createSampleSession()
    const mockClient: SetupApiClient = {
      getSetupSession: vi.fn().mockResolvedValue(sample),
      listSetupSessions: vi.fn().mockResolvedValue([sample]),
      createSetupSession: vi.fn(),
      resumeSetupSession: vi.fn(),
      runSetupCommand: vi.fn(),
    }

    render(<SetupApp client={mockClient} initialSessionId={sample.id} />)

    expect(await screen.findByText('Sample Mailnode Setup')).toBeDefined()
    expect(screen.getByText(/ID: set_sample_123/)).toBeDefined()

    // Stages in stage navigation
    expect(screen.getByText('DISCOVER')).toBeDefined()
    expect(screen.getByText('APPROVAL')).toBeDefined()

    // Evidence panel
    expect(screen.getByText(/Authoritative Evidence \(1\)/)).toBeDefined()
    expect(screen.getByText('discovery_record')).toBeDefined()
    expect(screen.getByText(/Block: Environment Discovery/)).toBeDefined()
  })

  it('enforces Tier 3 fail-closed typed confirmation phrase for destructive/approval blocks', async () => {
    const sample = createSampleSession()
    const mockClient: SetupApiClient = {
      getSetupSession: vi.fn().mockResolvedValue(sample),
      listSetupSessions: vi.fn().mockResolvedValue([sample]),
      createSetupSession: vi.fn(),
      resumeSetupSession: vi.fn(),
      runSetupCommand: vi.fn().mockResolvedValue({
        ...sample,
        currentStage: 'APPLY',
        blocks: sample.blocks.map((b) =>
          b.id === 'blk_appr_1' ? { ...b, status: 'passed' as const } : b,
        ),
      }),
    }

    render(<SetupApp client={mockClient} initialSessionId={sample.id} />)

    await screen.findByText('Sample Mailnode Setup')

    // Find the execute button: should be disabled until exact phrase is entered
    const executeBtn = screen.getByRole('button', { name: /Run approve/i })
    expect((executeBtn as HTMLButtonElement).disabled).toBe(true)

    // Type incorrect phrase
    const input = screen.getByPlaceholderText('confirm set_sample_123')
    fireEvent.change(input, { target: { value: 'confirm wrong' } })
    expect((executeBtn as HTMLButtonElement).disabled).toBe(true)

    // Type exact phrase
    fireEvent.change(input, { target: { value: 'confirm set_sample_123' } })
    expect((executeBtn as HTMLButtonElement).disabled).toBe(false)

    // Click execute
    fireEvent.click(executeBtn)

    await waitFor(() => {
      expect(mockClient.runSetupCommand).toHaveBeenCalledWith('set_sample_123', 'approve', {
        confirmation: 'confirm set_sample_123',
      })
    })
  })

  it('triggers resume when clicking Resume Setup button', async () => {
    const sample = createSampleSession()
    const mockClient: SetupApiClient = {
      getSetupSession: vi.fn().mockResolvedValue(sample),
      listSetupSessions: vi.fn().mockResolvedValue([sample]),
      createSetupSession: vi.fn(),
      resumeSetupSession: vi.fn().mockResolvedValue(sample),
      runSetupCommand: vi.fn(),
    }

    render(<SetupApp client={mockClient} initialSessionId={sample.id} />)

    await screen.findByText('Sample Mailnode Setup')

    const resumeBtn = screen.getByRole('button', { name: /Resume Setup/i })
    fireEvent.click(resumeBtn)

    await waitFor(() => {
      expect(mockClient.resumeSetupSession).toHaveBeenCalledWith('set_sample_123')
    })
  })
})
