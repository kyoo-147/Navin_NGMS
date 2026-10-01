import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore, ActionCoreError } from '../src/index.js'
import { createRecordingExecutor, createTempDir, openCore, removeTempDir } from './helpers.js'

describe('action lifecycle', () => {
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

  it('runs discover(gate) -> plan -> apply -> verify -> result', async () => {
    const executor = createRecordingExecutor()
    core.executors.registerExecutor(executor)

    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      parameters: { value: 7 },
      requestedBy: 'usr_admin',
      canRollback: true,
    })
    expect(action.status).toBe('staged')
    expect(action.stage).toBe('discover')

    const planned = await core.actionService.planAction(action.id)
    expect(planned.status).toBe('planned')
    expect(planned.stage).toBe('plan')
    expect(planned.diff?.summary).toBe('apply test.echo')

    const completed = await core.actionService.applyAction(action.id)
    expect(completed.status).toBe('completed')
    expect(completed.stage).toBe('result')
    expect(completed.verification?.passed).toBe(true)
    expect(executor.calls).toEqual(['plan', 'apply', 'verify'])

    const kinds = core.events.readSince(undefined, 0, 100).map((entry) => entry.event.kind)
    expect(kinds).toContain('action.planned')
    expect(kinds).toContain('action.applying')
    expect(kinds).toContain('action.completed')
    expect(core.audit.list({ actionName: 'test.echo' }).length).toBeGreaterThan(0)
  })

  it('rejects illegal transitions', () => {
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 0,
      requestedBy: 'usr_admin',
    })
    expect(() => core.actions.transition(action.id, 'completed')).toThrowError(ActionCoreError)
    try {
      core.actions.transition(action.id, 'completed')
    } catch (error) {
      expect((error as ActionCoreError).code).toBe('CONFLICT')
    }
  })

  it('records a truthful failure and error when apply fails', async () => {
    const executor = createRecordingExecutor({ failApply: new Error('engine rejected chat') })
    core.executors.registerExecutor(executor)
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
    })
    await core.actionService.planAction(action.id)

    await expect(core.actionService.applyAction(action.id)).rejects.toThrow('engine rejected chat')
    const failed = core.actionService.getAction(action.id)
    expect(failed.status).toBe('failed')
    expect(failed.error).toBeDefined()
    expect(core.audit.list({ actionName: 'test.echo' }).some((r) => r.outcome === 'failure')).toBe(
      true,
    )
  })

  it('rolls a completed action back through the executor port', async () => {
    const executor = createRecordingExecutor()
    core.executors.registerExecutor(executor)
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
      canRollback: true,
    })
    await core.actionService.applyAction(action.id)
    const rolledBack = await core.actionService.rollbackAction(action.id)
    expect(rolledBack.status).toBe('rolled_back')
    expect(executor.calls).toContain('rollback')
  })

  it('does not leak a successful rollback event or audit on rollback failure', async () => {
    const executor = createRecordingExecutor({ failRollback: new Error('rollback failed') })
    core.executors.registerExecutor(executor)
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
      canRollback: true,
    })
    await core.actionService.applyAction(action.id)

    await expect(core.actionService.rollbackAction(action.id)).rejects.toThrow('rollback failed')
    expect(core.actionService.getAction(action.id).status).toBe('rollback_failed')
    const kinds = core.events.readSince(undefined, 0, 100).map((entry) => entry.event.kind)
    expect(kinds).not.toContain('action.rolled_back')
    expect(
      core.audit
        .list({ actionName: 'test.echo', outcome: 'success' })
        .some((entry) => entry.details?.message === 'rollback failed'),
    ).toBe(false)
    expect(core.audit.list({ actionName: 'test.echo', outcome: 'failure' }).length).toBeGreaterThan(
      0,
    )
  })

  it('refuses to roll back an action that is not rollbackable', async () => {
    core.executors.registerExecutor(createRecordingExecutor({ canRollback: false }))
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
      canRollback: false,
    })
    await core.actionService.planAction(action.id)
    await core.actionService.applyAction(action.id)
    await expect(core.actionService.rollbackAction(action.id)).rejects.toMatchObject({
      code: 'ACTION_BLOCKED',
    })
  })

  it('requires a registered executor port and never mutates infrastructure itself', async () => {
    const { action } = core.actionService.stageAction({
      name: 'unregistered.action',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
    })
    await expect(core.actionService.applyAction(action.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('refuses to complete a mutation when verification is missing', async () => {
    const executor = createRecordingExecutor({ withoutVerify: true })
    core.executors.registerExecutor(executor)
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
    })
    await core.actionService.planAction(action.id)
    await expect(core.actionService.applyAction(action.id)).rejects.toMatchObject({
      code: 'ACTION_BLOCKED',
    })
    expect(executor.calls).toEqual(['plan'])
    expect(core.actionService.getAction(action.id).status).toBe('planned')
  })
})
