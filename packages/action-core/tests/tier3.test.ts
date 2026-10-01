import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore } from '../src/index.js'
import { createRecordingExecutor, createTempDir, openCore, removeTempDir } from './helpers.js'

describe('tier 3 controls and risk approval', () => {
  let dir: string
  let core: ActionCore

  beforeEach(() => {
    dir = createTempDir()
    core = openCore(dir)
    core.executors.registerExecutor(createRecordingExecutor({ name: 'restore.mailbox' }))
  })

  afterEach(() => {
    core.close()
    removeTempDir(dir)
  })

  function stageTier3() {
    return core.actionService.stageAction({
      name: 'restore.mailbox',
      surface: 'control',
      riskTier: 3,
      parameters: { mailboxId: 'mbx_target' },
      requestedBy: 'usr_admin',
      canRollback: true,
    })
  }

  it('stages a tier 3 action with a mandatory pending typed approval', () => {
    const { action, approval } = stageTier3()
    expect(action.riskTier).toBe(3)
    expect(action.approvalId).toBeDefined()
    expect(approval?.status).toBe('pending')
    expect(approval?.confirmationType).toBe('typed_confirmation')
    expect(approval?.requiresRecentAuth).toBe(true)
    expect(approval?.typedPhrase).toBe(`APPROVE restore.mailbox ${action.id}`)
  })

  it('cannot be forced past approval with --yes style force', async () => {
    const { action } = stageTier3()
    await expect(core.actionService.applyAction(action.id)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    })
    await expect(core.actionService.applyAction(action.id, { force: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects a mismatched typed confirmation phrase', () => {
    const { approval } = stageTier3()
    expect(() =>
      core.actionService.decideApproval(approval!.id, {
        decidedBy: 'usr_admin',
        decision: 'approved',
        stepUpVerified: true,
        typedPhrase: 'APPROVE something else',
      }),
    ).toThrowError(/exact typed confirmation phrase/)
    expect(core.approvals.require(approval!.id).status).toBe('pending')
  })

  it('requires recent authentication (step-up) for tier 3 approval', () => {
    const { approval } = stageTier3()
    expect(() =>
      core.actionService.decideApproval(approval!.id, {
        decidedBy: 'usr_admin',
        decision: 'approved',
        stepUpVerified: false,
        typedPhrase: approval!.typedPhrase,
      }),
    ).toThrowError(/recent authentication/)
  })

  it('applies only after typed + step-up approved', async () => {
    const { action, approval } = stageTier3()
    core.actionService.decideApproval(approval!.id, {
      decidedBy: 'usr_admin',
      decision: 'approved',
      stepUpVerified: true,
      typedPhrase: approval!.typedPhrase,
    })
    expect(core.actionService.getAction(action.id).status).toBe('approved')
    const completed = await core.actionService.applyAction(action.id)
    expect(completed.status).toBe('completed')
  })

  it('blocks a rejected tier 3 action', async () => {
    const { action, approval } = stageTier3()
    core.actionService.decideApproval(approval!.id, {
      decidedBy: 'usr_admin',
      decision: 'rejected',
      reason: 'not authorized',
    })
    expect(core.actionService.getAction(action.id).status).toBe('rejected')
    await expect(core.actionService.applyAction(action.id)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    })
  })

  it('requires an approvalId to even persist a tier 3 action', () => {
    expect(() =>
      core.actions.create({
        name: 'restore.mailbox',
        surface: 'control',
        riskTier: 3,
        requestedBy: 'usr_admin',
      }),
    ).toThrowError(/action execution/)
  })

  it('requires explicit diff approval for tier 2', async () => {
    core.executors.registerExecutor(createRecordingExecutor({ name: 'dns.update' }))
    const { action } = core.actionService.stageAction({
      name: 'dns.update',
      surface: 'control',
      riskTier: 2,
      requestedBy: 'usr_admin',
    })
    await expect(core.actionService.applyAction(action.id)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    })

    const approval = core.actionService.requestApproval(action.id)
    expect(approval.confirmationType).toBe('explicit_diff')
    core.actionService.decideApproval(approval.id, {
      decidedBy: 'usr_admin',
      decision: 'approved',
      reason: 'diff reviewed',
    })
    const completed = await core.actionService.applyAction(action.id)
    expect(completed.status).toBe('completed')
  })
})
