import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore } from '../src/index.js'
import { createRecordingExecutor, createTempDir, removeTempDir } from './helpers.js'

describe('durable execution attempts and unknown-outcome recovery', () => {
  let dir: string
  let dbPath: string
  let core: ActionCore

  beforeEach(() => {
    dir = createTempDir()
    dbPath = join(dir, 'attempts.db')
    core = ActionCore.open({ path: dbPath })
  })

  afterEach(() => {
    core.close()
    removeTempDir(dir)
  })

  function stage() {
    return core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      requestedBy: 'usr_admin',
    }).action
  }

  it('records the dispatched reservation before the executor side effect and passes key/attempt', async () => {
    const observed: Array<{
      status?: string
      key?: string
      callerKey?: string
      attemptId?: string
    }> = []
    const executor = createRecordingExecutor({
      onApply: (_parameters, ctx) => {
        const attempt =
          ctx.callerIdempotencyKey === undefined
            ? core.attempts.findByExternalIdempotencyKey(ctx.idempotencyKey ?? '')
            : core.attempts.findByIdempotencyKey(ctx.callerIdempotencyKey)
        observed.push({
          status: attempt?.status,
          key: ctx.idempotencyKey,
          callerKey: ctx.callerIdempotencyKey,
          attemptId: ctx.attemptId,
        })
      },
    })
    core.executors.registerExecutor(executor)
    const action = stage()
    await core.actionService.planAction(action.id)

    await core.actionService.applyAction(action.id, { idempotencyKey: 'key-1' })

    expect(observed).toHaveLength(1)
    expect(observed[0]?.status).toBe('dispatched')
    expect(observed[0]?.key).toBe(`navin-action:${action.id}`)
    expect(observed[0]?.callerKey).toBe('key-1')
    expect(observed[0]?.attemptId).toEqual(expect.any(String))
    expect(core.attempts.findByIdempotencyKey('key-1')?.status).toBe('succeeded')
  })

  it('marks a dispatched attempt unknown after a crash and blocks a blind retry', async () => {
    core.executors.registerExecutor(createRecordingExecutor())
    const action = stage()
    await core.actionService.planAction(action.id)

    const attempt = core.db.transaction(() =>
      core.attempts.begin({
        actionId: action.id,
        idempotencyKey: 'crash-key',
        now: new Date().toISOString(),
      }),
    )
    core.db.transaction(() => {
      core.attempts.markDispatched(attempt.id)
      core.actions.transition(action.id, 'applying')
    })
    core.close()

    core = ActionCore.open({ path: dbPath })
    const recovered = core.actionService.recoverInterrupted()

    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.status).toBe('failed')
    expect(recovered[0]?.error?.retryable).toBe(false)
    expect(recovered[0]?.error?.details?.needsAttention).toBe(true)
    expect(core.attempts.findByIdempotencyKey('crash-key')?.status).toBe('unknown')

    core.executors.registerExecutor(createRecordingExecutor())
    await expect(
      core.actionService.applyAction(action.id, { idempotencyKey: 'crash-key' }),
    ).rejects.toMatchObject({ code: 'ACTION_BLOCKED' })
  })

  it('reconciles an unknown outcome with verification without reapplying', async () => {
    core.executors.registerExecutor(createRecordingExecutor())
    const action = stage()
    await core.actionService.planAction(action.id)

    const attempt = core.db.transaction(() =>
      core.attempts.begin({
        actionId: action.id,
        idempotencyKey: 'reconcile-key',
        now: new Date().toISOString(),
      }),
    )
    core.db.transaction(() => {
      core.attempts.markDispatched(attempt.id)
      core.actions.transition(action.id, 'applying')
    })
    core.close()

    core = ActionCore.open({ path: dbPath })
    core.actionService.recoverInterrupted()
    const executor = createRecordingExecutor()
    core.executors.registerExecutor(executor)

    const reconciled = await core.actionService.reconcileUnknownAction(action.id)
    expect(reconciled.status).toBe('completed')
    expect(executor.calls).toEqual(['verify'])
    expect(core.attempts.findByIdempotencyKey('reconcile-key')?.status).toBe('succeeded')
  })

  it('preserves the external key across restart and unknown-outcome recovery', async () => {
    let firstKey: string | undefined
    const firstExecutor = createRecordingExecutor({
      failApply: new Error('simulated executor disconnect'),
      onApply: (_parameters, ctx) => {
        firstKey = ctx.idempotencyKey
      },
    })
    core.executors.registerExecutor(firstExecutor)
    const action = stage()
    await core.actionService.planAction(action.id)

    await expect(core.actionService.applyAction(action.id)).rejects.toThrow(
      'simulated executor disconnect',
    )
    expect(firstKey).toBe(`navin-action:${action.id}`)
    expect(core.attempts.latestForAction(action.id)?.status).toBe('unknown')
    core.close()

    core = ActionCore.open({ path: dbPath })
    core.actionService.recoverInterrupted()
    const verifyKeys: string[] = []
    const recoveryExecutor = createRecordingExecutor({
      onApply: () => {
        throw new Error('apply must not run during reconciliation')
      },
    })
    const originalVerify = recoveryExecutor.verify
    recoveryExecutor.verify = async (parameters, ctx) => {
      verifyKeys.push(ctx.idempotencyKey ?? '')
      return originalVerify!(parameters, ctx)
    }
    core.executors.registerExecutor(recoveryExecutor)

    const reconciled = await core.actionService.reconcileUnknownAction(action.id)
    expect(reconciled.status).toBe('completed')
    expect(verifyKeys).toEqual([firstKey])
  })

  it('treats a reservation that never dispatched as safe to retry', async () => {
    core.executors.registerExecutor(createRecordingExecutor())
    const action = stage()
    await core.actionService.planAction(action.id)

    core.db.transaction(() => {
      core.attempts.begin({
        actionId: action.id,
        idempotencyKey: 'safe-key',
        now: new Date().toISOString(),
      })
      core.actions.transition(action.id, 'applying')
    })
    core.close()

    core = ActionCore.open({ path: dbPath })
    const recovered = core.actionService.recoverInterrupted()

    expect(recovered[0]?.error?.retryable).toBe(true)
    expect(recovered[0]?.error?.details?.needsAttention).toBe(false)
    expect(core.attempts.findByIdempotencyKey('safe-key')?.status).toBe('aborted')

    core.executors.registerExecutor(createRecordingExecutor())
    const completed = await core.actionService.applyAction(action.id, {
      idempotencyKey: 'safe-key',
    })
    expect(completed.status).toBe('completed')
  })
})
