import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore, ActionCoreError } from '../src/index.js'
import { createRecordingExecutor, createTempDir, openCore, removeTempDir } from './helpers.js'

describe('idempotency and concurrency', () => {
  let dir: string
  let core: ActionCore

  beforeEach(() => {
    dir = createTempDir()
    core = openCore(dir)
    core.executors.registerExecutor(createRecordingExecutor())
  })

  afterEach(() => {
    core.close()
    removeTempDir(dir)
  })

  it('reuses an action for a repeated idempotency key', () => {
    const first = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      parameters: { value: 1 },
      requestedBy: 'usr_admin',
      idempotencyKey: 'stage-key-1',
    })
    const second = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      parameters: { value: 1 },
      requestedBy: 'usr_admin',
      idempotencyKey: 'stage-key-1',
    })
    expect(second.action.id).toBe(first.action.id)
    expect(core.actions.list({ name: 'test.echo' })).toHaveLength(1)
  })

  it('rejects an idempotency key reused with a different body', () => {
    core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      parameters: { value: 1 },
      requestedBy: 'usr_admin',
      idempotencyKey: 'stage-key-2',
    })
    expect(() =>
      core.actionService.stageAction({
        name: 'test.echo',
        surface: 'control',
        riskTier: 1,
        parameters: { value: 999 },
        requestedBy: 'usr_admin',
        idempotencyKey: 'stage-key-2',
      }),
    ).toThrowError(ActionCoreError)
  })

  it('does not re-apply an action for a repeated apply key', async () => {
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
    })
    await core.actionService.planAction(action.id)
    await core.actionService.applyAction(action.id, { idempotencyKey: 'apply-key-1' })
    const completed = await core.actionService.applyAction(action.id, {
      idempotencyKey: 'apply-key-1',
    })
    expect(completed.status).toBe('completed')
    expect(core.idempotency.find('action:apply', 'apply-key-1')?.resourceId).toBe(action.id)
  })

  it('rejects concurrent apply of the same action', async () => {
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
    })
    await core.actionService.planAction(action.id)
    const first = core.actionService.applyAction(action.id)
    await expect(core.actionService.applyAction(action.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await first
  })

  it('detects a stale revision with optimistic concurrency', () => {
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
    })
    const revision = core.actions.getRevision(action.id)
    core.actions.update(action.id, { parameters: { value: 1 } }, revision)
    expect(() =>
      core.actions.update(action.id, { parameters: { value: 2 } }, revision),
    ).toThrowError(/modified concurrently/)
  })

  it('serializes writers across two connections and releases the lock on rollback', () => {
    const dbPath = join(dir, 'shared.db')
    const writer = ActionCore.open({ path: dbPath })
    const other = ActionCore.open({ path: dbPath, busyTimeoutMs: 50 })
    const timestamp = new Date().toISOString()
    const insert = (id: string) =>
      other.db
        .prepare(
          `INSERT INTO events (id, api_version, kind, channel, timestamp) VALUES (?, '1', 'x', 'system', ?)`,
        )
        .run(id, timestamp)

    writer.db.exec('BEGIN IMMEDIATE')
    writer.db
      .prepare(
        `INSERT INTO events (id, api_version, kind, channel, timestamp) VALUES ('evt_locked', '1', 'x', 'system', ?)`,
      )
      .run(timestamp)

    let lockError: unknown
    try {
      insert('evt_blocked')
    } catch (error) {
      lockError = error
    }
    expect(lockError).toBeDefined()

    writer.db.exec('ROLLBACK')
    expect(() => insert('evt_after_rollback')).not.toThrow()

    writer.close()
    other.close()
  })
})
