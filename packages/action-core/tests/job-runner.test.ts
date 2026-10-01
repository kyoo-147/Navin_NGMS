import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore, REDACTED } from '../src/index.js'
import type { JobHandlerPort } from '../src/index.js'
import { createTempDir, openCore, removeTempDir } from './helpers.js'

describe('job runner', () => {
  let dir: string
  let core: ActionCore

  beforeEach(() => {
    dir = createTempDir()
    core = openCore(dir)
  })

  afterEach(() => {
    core.close()
    removeTempDir(dir)
  })

  it('runs a job to completion and streams progress events', async () => {
    const handler: JobHandlerPort = {
      name: 'test.job',
      async run(_job, ctx) {
        ctx.reportProgress({ message: 'half way', percentage: 50, step: 'sync' })
        ctx.emitEvent({ kind: 'job.detail', data: { copied: 5 } })
        return { ok: true }
      },
    }
    const job = core.jobRunner.createJob({
      name: 'test.job',
      surface: 'control',
      payload: { total: 10 },
    })
    expect(job.status).toBe('queued')

    const completed = await core.jobRunner.run(job.id, { handler })
    expect(completed.status).toBe('completed')
    expect(completed.result).toEqual({ ok: true })
    expect(completed.startedAt).toBeDefined()
    expect(completed.completedAt).toBeDefined()

    const kinds = core.events.readForJob(job.id).map((entry) => entry.event.kind)
    expect(kinds).toContain('job.running')
    expect(kinds).toContain('job.progress')
    expect(kinds).toContain('job.detail')
    expect(kinds).toContain('job.completed')
  })

  it('records a truthful failure', async () => {
    const handler: JobHandlerPort = {
      name: 'test.job',
      async run() {
        throw new Error('sync exploded')
      },
    }
    const job = core.jobRunner.createJob({ name: 'test.job', surface: 'control' })
    await expect(core.jobRunner.run(job.id, { handler })).rejects.toThrow('sync exploded')
    const failed = core.jobRunner.getJob(job.id)
    expect(failed.status).toBe('failed')
    expect(failed.error?.message).toBe('sync exploded')
  })

  it('cancels queued jobs and refuses non-cancellable ones', () => {
    const cancellable = core.jobRunner.createJob({
      name: 'test.job',
      surface: 'control',
      cancellable: true,
    })
    expect(core.jobRunner.cancel(cancellable.id).status).toBe('cancelled')

    const locked = core.jobRunner.createJob({
      name: 'test.job',
      surface: 'control',
      cancellable: false,
    })
    expect(() => core.jobRunner.cancel(locked.id)).toThrowError(/not cancellable/)
  })

  it('reuses a job for a repeated idempotency key and redacts payloads', () => {
    const first = core.jobRunner.createJob({
      name: 'test.job',
      surface: 'control',
      payload: { password: 'hunter2', total: 1 },
      idempotencyKey: 'job-key-1',
    })
    const second = core.jobRunner.createJob({
      name: 'test.job',
      surface: 'control',
      payload: { password: 'hunter2', total: 1 },
      idempotencyKey: 'job-key-1',
    })
    expect(second.id).toBe(first.id)
    expect(first.payload.password).toBe(REDACTED)
    expect(first.payload.total).toBe(1)
    expect(core.jobs.list({ name: 'test.job' })).toHaveLength(1)
  })

  it('marks jobs left running by a restart as interrupted', () => {
    const job = core.jobRunner.createJob({ name: 'test.job', surface: 'control', resumable: true })
    core.jobs.update(job.id, { status: 'running' })
    const recovered = core.jobRunner.recoverInterrupted()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.status).toBe('interrupted')
  })
})
