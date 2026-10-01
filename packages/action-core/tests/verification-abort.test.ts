import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore } from '../src/index.js'
import { createRecordingExecutor, createTempDir, openCore, removeTempDir } from './helpers.js'

describe('mutation verification and abort safety', () => {
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

  async function stagePlanned(canRollback = true) {
    const { action } = core.actionService.stageAction({
      name: 'test.echo',
      surface: 'control',
      riskTier: 1,
      parameters: { value: 1 },
      requestedBy: 'usr_admin',
      canRollback,
    })
    await core.actionService.planAction(action.id)
    return action.id
  }

  it('rejects metadata-only verification even when passed is true', async () => {
    const executor = createRecordingExecutor({ metadataOnlyVerify: true })
    core.executors.registerExecutor(executor)
    const actionId = await stagePlanned()

    const result = await core.actionService.applyAction(actionId)

    expect(result.status).toBe('failed')
    expect(result.error?.details?.metadataOnly).toBe(true)
    expect(result.error?.details?.needsAttention).toBe(true)
    expect(executor.calls).toEqual(['plan', 'apply', 'verify'])
  })

  it('fails a mutation (never completes) when verification reports passed:false', async () => {
    const executor = createRecordingExecutor({ verifyPassed: false })
    core.executors.registerExecutor(executor)
    const actionId = await stagePlanned()

    const result = await core.actionService.applyAction(actionId)

    expect(result.status).toBe('failed')
    expect(result.verification).toBeUndefined()
    expect(result.error?.code).toBe('PRECONDITION_FAILED')
    expect(result.error?.details?.needsAttention).toBe(true)
    expect(executor.calls).toEqual(['plan', 'apply', 'verify'])

    const kinds = core.events.readSince(undefined, 0, 200).map((entry) => entry.event.kind)
    expect(kinds).toContain('action.verification_failed')
    expect(kinds).not.toContain('action.completed')

    const evidence = core.evidence.list({ status: 'failed' })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.checkType).toBe('custom_check')
    expect(evidence[0]?.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('fails with needs-attention when verification throws', async () => {
    const executor = createRecordingExecutor({ failVerify: new Error('verify exploded') })
    core.executors.registerExecutor(executor)
    const actionId = await stagePlanned()

    const result = await core.actionService.applyAction(actionId)

    expect(result.status).toBe('failed')
    expect(result.error?.retryable).toBe(false)
    expect(result.error?.details?.needsAttention).toBe(true)
    expect(executor.calls).toEqual(['plan', 'apply', 'verify'])
    expect(core.events.readSince(undefined, 0, 200).map((e) => e.event.kind)).not.toContain(
      'action.completed',
    )
  })

  it('allows rolling back a mutation that failed verification', async () => {
    const executor = createRecordingExecutor({ verifyPassed: false })
    core.executors.registerExecutor(executor)
    const actionId = await stagePlanned()

    const failed = await core.actionService.applyAction(actionId)
    expect(failed.canRollback).toBe(true)

    const rolledBack = await core.actionService.rollbackAction(actionId)
    expect(rolledBack.status).toBe('rolled_back')
    expect(executor.calls).toContain('rollback')
  })

  it('aborts before dispatch with no side effect, then safely retries', async () => {
    const executor = createRecordingExecutor()
    core.executors.registerExecutor(executor)
    const actionId = await stagePlanned()

    const controller = new AbortController()
    controller.abort()

    await expect(
      core.actionService.applyAction(actionId, {
        signal: controller.signal,
        idempotencyKey: 'abort-key',
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })

    expect(executor.calls).not.toContain('apply')
    expect(core.attempts.findByIdempotencyKey('abort-key')?.status).toBe('aborted')
    expect(core.actionService.getAction(actionId).status).toBe('planned')

    const completed = await core.actionService.applyAction(actionId, {
      idempotencyKey: 'abort-key',
    })
    expect(completed.status).toBe('completed')
    expect(core.attempts.findByIdempotencyKey('abort-key')?.status).toBe('succeeded')
  })

  it('aborts after dispatch without verifying or completing, and marks needs-attention', async () => {
    const controller = new AbortController()
    const executor = createRecordingExecutor({
      onApply: () => {
        controller.abort()
      },
    })
    core.executors.registerExecutor(executor)
    const actionId = await stagePlanned()

    const result = await core.actionService.applyAction(actionId, { signal: controller.signal })

    expect(result.status).toBe('failed')
    expect(result.error?.details?.needsAttention).toBe(true)
    expect(executor.calls).toContain('apply')
    expect(executor.calls).not.toContain('verify')
    expect(executor.contexts.some((ctx) => ctx.signal === controller.signal)).toBe(true)
    expect(core.attempts.listByAction(actionId)[0]?.status).toBe('unknown')
  })
})
