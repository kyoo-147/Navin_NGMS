import { describe, it, expect } from 'vitest'
import {
  SetupStageSchema,
  SetupBlockKindSchema,
  SetupBlockStatusSchema,
  SetupBlockSchema,
  SetupSessionSchema,
  SetupEventSchema,
  validate,
  isValid,
} from '../src/index.js'

describe('Setup Contracts: Stages, Blocks, and Sessions', () => {
  it('validates canonical setup stages', () => {
    expect(isValid(SetupStageSchema, 'WELCOME')).toBe(true)
    expect(isValid(SetupStageSchema, 'DISCOVER')).toBe(true)
    expect(isValid(SetupStageSchema, 'CUTOVER_APPROVAL')).toBe(true)
    expect(isValid(SetupStageSchema, 'READY')).toBe(true)
    expect(isValid(SetupStageSchema, 'UNKNOWN_STAGE')).toBe(false)
  })

  it('validates block kinds and statuses', () => {
    expect(isValid(SetupBlockKindSchema, 'question')).toBe(true)
    expect(isValid(SetupBlockKindSchema, 'diff')).toBe(true)
    expect(isValid(SetupBlockKindSchema, 'verification')).toBe(true)
    expect(isValid(SetupBlockKindSchema, 'random_kind')).toBe(false)

    expect(isValid(SetupBlockStatusSchema, 'pending')).toBe(true)
    expect(isValid(SetupBlockStatusSchema, 'running')).toBe(true)
    expect(isValid(SetupBlockStatusSchema, 'passed')).toBe(true)
    expect(isValid(SetupBlockStatusSchema, 'rollback_running')).toBe(true)
    expect(isValid(SetupBlockStatusSchema, 'rolled_back')).toBe(true)
    expect(isValid(SetupBlockStatusSchema, 'invalid_status')).toBe(false)
  })

  it('validates a complete SetupBlock', () => {
    const validBlock = {
      id: 'blk_disc_001',
      sessionId: 'set_20261001_vps1',
      schemaVersion: '1',
      stage: 'DISCOVER',
      kind: 'discovery',
      status: 'passed',
      title: 'Host Discovery',
      summary: 'Discovered Linux x86_64, 4 CPUs, 8GB RAM, Docker Compose present',
      value: {
        os: 'Ubuntu 24.04',
        portsFree: [25, 80, 443, 993],
      },
      evidenceIds: ['evi_docker_check', 'evi_port_scan'],
      risk: 'read',
      canRetry: true,
      canRollback: false,
      dependencies: [],
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:01:00.000Z',
    }

    expect(isValid(SetupBlockSchema, validBlock)).toBe(true)
    const res = validate(SetupBlockSchema, validBlock)
    expect(res.success).toBe(true)
  })

  it('validates a SetupSession with blocks and cursor and enforces fingerprint on remote hosts', () => {
    const validSession = {
      id: 'set_session_alpha',
      title: 'New Mail Server Setup - mail.production.example.invalid',
      currentStage: 'PLAN',
      status: 'active',
      intelligenceMode: 'local_model',
      targetHost: {
        kind: 'ssh_vps',
        host: '198.51.100.24',
        fingerprint: 'SHA256:4a8b1c9d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
      },
      blocks: [
        {
          id: 'blk_init_0',
          sessionId: 'set_session_alpha',
          schemaVersion: '1',
          stage: 'WELCOME',
          kind: 'question',
          status: 'passed',
          title: 'Welcome choices',
          summary: 'Selected: Setup new mail server',
          canRetry: false,
          canRollback: false,
          dependencies: [],
          createdAt: '2026-10-01T09:30:00.000Z',
          updatedAt: '2026-10-01T09:31:00.000Z',
        },
      ],
      eventCursor: 'evt_1042',
      createdAt: '2026-10-01T09:30:00.000Z',
      updatedAt: '2026-10-01T09:35:00.000Z',
    }

    expect(isValid(SetupSessionSchema, validSession)).toBe(true)
    const res = validate(SetupSessionSchema, validSession)
    expect(res.success).toBe(true)

    // Negative: ssh_vps without fingerprint must be rejected
    const sshMissingFingerprint = {
      ...validSession,
      targetHost: {
        kind: 'ssh_vps',
        host: '198.51.100.24',
      },
    }
    expect(isValid(SetupSessionSchema, sshMissingFingerprint)).toBe(false)

    // Negative: remote_daemon without fingerprint must be rejected
    const daemonMissingFingerprint = {
      ...validSession,
      targetHost: {
        kind: 'remote_daemon',
        host: '198.51.100.24',
      },
    }
    expect(isValid(SetupSessionSchema, daemonMissingFingerprint)).toBe(false)

    // Valid: local target host does not require fingerprint
    const localTargetSession = {
      ...validSession,
      targetHost: {
        kind: 'local',
      },
    }
    expect(isValid(SetupSessionSchema, localTargetSession)).toBe(true)
  })

  it('validates a SetupEvent for SSE reconnect stream', () => {
    const validEvent = {
      apiVersion: '1',
      kind: 'setup.block.updated',
      id: 'evt_event99',
      timestamp: '2026-10-01T10:02:00.000Z',
      payload: {
        sessionId: 'set_session_alpha',
        blockId: 'blk_disc_001',
        previousStatus: 'running',
        newStatus: 'passed',
      },
    }

    expect(isValid(SetupEventSchema, validEvent)).toBe(true)
  })
})
