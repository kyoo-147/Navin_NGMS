import { describe, it, expect } from 'vitest'
import {
  JobStatusSchema,
  JobProgressSchema,
  JobSchema,
  BackgroundEventSchema,
  validate,
  isValid,
} from '../src/index.js'

describe('Jobs & Background Events Contracts', () => {
  it('validates canonical job statuses', () => {
    const validStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']
    for (const status of validStatuses) {
      expect(isValid(JobStatusSchema, status)).toBe(true)
    }
    expect(isValid(JobStatusSchema, 'in_progress')).toBe(false)
  })

  it('validates JobProgress representation', () => {
    const progress = {
      current: 45,
      total: 100,
      percentage: 45.0,
      message: 'Migrating messages: 45/100 completed',
      step: 'sync_messages',
    }

    expect(isValid(JobProgressSchema, progress)).toBe(true)
    const res = validate(JobProgressSchema, progress)
    expect(res.success).toBe(true)
  })

  it('validates a complete Job record with cancellation and idempotency', () => {
    const job = {
      id: 'job_mig_001',
      name: 'migration.mailbox_sync',
      surface: 'control',
      status: 'running',
      idempotencyKey: 'idemp_mig_box_42',
      cancellable: true,
      resumable: true,
      progress: {
        message: 'Syncing folders',
        step: 'folders',
      },
      payload: {
        sourceMailbox: 'user@oldserver.com',
        targetUserId: 'usr_target42',
      },
      createdAt: '2026-10-01T10:00:00.000Z',
      startedAt: '2026-10-01T10:00:05.000Z',
    }

    expect(isValid(JobSchema, job)).toBe(true)
    const res = validate(JobSchema, job)
    expect(res.success).toBe(true)
  })

  it('validates SSE BackgroundEvent envelope with channel and cursor', () => {
    const sseEvent = {
      apiVersion: '1',
      kind: 'job.progress',
      id: 'evt_cursor_108',
      timestamp: '2026-10-01T10:00:10.000Z',
      payload: {
        channel: 'jobs',
        jobId: 'job_mig_001',
        status: 'running',
        progress: {
          current: 10,
          total: 100,
          percentage: 10,
          message: '10% complete',
        },
      },
      metadata: {
        cursor: '108',
      },
    }

    expect(isValid(BackgroundEventSchema, sseEvent)).toBe(true)
  })
})
