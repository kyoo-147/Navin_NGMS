import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore } from '../src/index.js'
import { createTempDir, openCore, removeTempDir } from './helpers.js'

describe('SQLite WAL persistence and restart', () => {
  let dir: string

  beforeEach(() => {
    dir = createTempDir()
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  it('opens in WAL mode and reports the migrated schema version', () => {
    const core = openCore(dir)
    const description = core.describe()
    expect(description.journalMode).toBe('wal')
    expect(description.schemaVersion).toBe(3)
    expect(description.latestSchemaVersion).toBe(3)
    expect(description.open).toBe(true)
    core.close()
  })

  it('survives a clean close/reopen with all records and cursors intact', () => {
    const dbPath = join(dir, 'restart.db')
    const clock = () => new Date('2026-10-01T10:00:00.000Z')

    const first = ActionCore.open({ path: dbPath, clock })
    const { action } = first.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      parameters: { value: 1 },
      requestedBy: 'usr_admin',
      canRollback: true,
      idempotencyKey: 'persist-stage-1',
    })
    const job = first.jobRunner.createJob({
      name: 'test.job',
      surface: 'control',
      payload: { total: 3 },
    })
    const event = first.events.append({ kind: 'custom.event', channel: 'system' })
    const evidence = first.evidence.append({
      checkType: 'custom_check',
      status: 'passed',
      target: 'example.com',
      collector: 'navind.test',
      details: { note: 'durable', receipt: `sha256:${'b'.repeat(64)}` },
      rawOutputRedacted: 'custom-check output',
    })
    first.close()

    const second = ActionCore.open({ path: dbPath, clock })
    expect(second.actionService.getAction(action.id).status).toBe('staged')
    expect(second.jobRunner.getJob(job.id).status).toBe('queued')
    expect(second.evidence.get(evidence.id)?.details.note).toBe('durable')

    const next = second.events.append({ kind: 'custom.event.2', channel: 'system' })
    expect(next.seq).toBeGreaterThan(event.seq)

    const replayed = second.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      parameters: { value: 1 },
      requestedBy: 'usr_admin',
      canRollback: true,
      idempotencyKey: 'persist-stage-1',
    })
    expect(replayed.action.id).toBe(action.id)
    expect(second.actions.list({ name: 'test.echo' })).toHaveLength(1)
    second.close()
  })

  it('preserves audit records across a restart', () => {
    const dbPath = join(dir, 'audit.db')
    const first = ActionCore.open({ path: dbPath })
    first.audit.append({
      actor: { userId: 'usr_admin', role: 'ops.super_admin', surface: 'control' },
      actionName: 'dns.update_dkim_selector',
      target: { domainId: 'dom_example', resourceType: 'domain' },
      outcome: 'success',
      riskTier: 2,
      details: { selector: '202610a' },
    })
    first.close()

    const second = ActionCore.open({ path: dbPath })
    expect(second.audit.count()).toBe(1)
    expect(second.audit.list()[0]?.actionName).toBe('dns.update_dkim_selector')
    second.close()
  })
})
