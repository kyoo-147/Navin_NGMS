import { afterEach, describe, it, expect } from 'vitest'
import { encodeId, upstreamId } from '../src/index.js'
import { createHarness, type GatewayHarness } from './fixtures/harness.js'
import { CAP_CORE, CAP_MAIL, CAP_SUBMISSION } from './fixtures/jmap-fixture.js'

const harnesses: GatewayHarness[] = []

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()
    if (harness) await harness.close()
  }
})

async function harness(options: Parameters<typeof createHarness>[0] = {}): Promise<GatewayHarness> {
  const created = await createHarness(options)
  harnesses.push(created)
  return created
}

function baseSubmission(accountId: string, idempotencyKey: string) {
  return {
    accountId,
    senderIdentityId: encodeId('als', 'id-1'),
    idempotencyKey,
    from: { address: 'user@example.org' },
    to: [{ address: 'partner@example.org' }],
    subject: 'Status update',
    bodyText: 'All good.',
    bodyHtml: '<p>All good.</p>',
  }
}

describe('MailGateway submission', () => {
  it('creates a draft then submits it and reports sent', async () => {
    const h = await harness()
    const before = h.fixture.emails.length
    const result = await h.gateway.submit(h.ctx, baseSubmission(h.accountId, 'sub-sent'))

    expect(result.status).toBe('sent')
    expect(result.idempotencyKey).toBe('sub-sent')
    expect(result.messageId).toMatch(/^msg_/)
    expect(upstreamId(result.submissionId)).toMatch(/^s\d+$/)
    expect(h.fixture.emails.length).toBe(before + 1)
    expect(h.fixture.emails.some((email) => email.mailboxIds.has('mb-sent'))).toBe(true)
  })

  it('holds the submission for undo when a delay is requested', async () => {
    const h = await harness()
    const result = await h.gateway.submit(h.ctx, {
      ...baseSubmission(h.accountId, 'sub-undo'),
      undoDelaySeconds: 30,
    })
    expect(result.status).toBe('held_for_undo')
    expect(result.undoWindowExpiresAt).toBeDefined()
    expect(h.fixture.emails.some((email) => email.mailboxIds.has('mb-drafts'))).toBe(true)
  })

  it('schedules a future submission', async () => {
    const h = await harness()
    const result = await h.gateway.submit(h.ctx, {
      ...baseSubmission(h.accountId, 'sub-sched'),
      sendAt: new Date(Date.now() + 3_600_000).toISOString(),
    })
    expect(result.status).toBe('scheduled')
  })

  it('fails closed for scheduling when the engine lacks the capability', async () => {
    const h = await harness({ capabilities: [CAP_CORE, CAP_MAIL, CAP_SUBMISSION] })
    await expect(
      h.gateway.submit(h.ctx, {
        ...baseSubmission(h.accountId, 'sub-no-sched'),
        undoDelaySeconds: 10,
      }),
    ).rejects.toMatchObject({ code: 'ACTION_BLOCKED' })
  })

  it('fails closed when the engine lacks the submission capability', async () => {
    const h = await harness({ capabilities: [CAP_CORE, CAP_MAIL] })
    await expect(
      h.gateway.submit(h.ctx, baseSubmission(h.accountId, 'sub-no-sub')),
    ).rejects.toMatchObject({
      code: 'ACTION_BLOCKED',
    })
  })

  it('rejects a sender identity not authorized for the From address', async () => {
    const h = await harness()
    await expect(
      h.gateway.submit(h.ctx, {
        ...baseSubmission(h.accountId, 'sub-forbidden'),
        from: { address: 'someone-else@example.org' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects attachments without an uploaded blob id', async () => {
    const h = await harness()
    await expect(
      h.gateway.submit(h.ctx, {
        ...baseSubmission(h.accountId, 'sub-attach'),
        attachments: [{ filename: 'spec.pdf', mimeType: 'application/pdf', size: 10 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('replays an idempotent submission without a second upstream call', async () => {
    const h = await harness()
    const request = baseSubmission(h.accountId, 'sub-dup')
    const first = await h.gateway.submit(h.ctx, request)
    const callsAfterFirst = h.fixture.stats.methodCalls
    const replay = await h.gateway.submit(h.ctx, request)
    expect(replay).toEqual(first)
    expect(h.fixture.stats.methodCalls).toBe(callsAfterFirst)
  })

  it('cancels a held submission', async () => {
    const h = await harness()
    const result = await h.gateway.submit(h.ctx, {
      ...baseSubmission(h.accountId, 'sub-cancel'),
      undoDelaySeconds: 30,
    })
    const canceled = await h.gateway.cancelSubmission(h.ctx, h.accountId, result.submissionId)
    expect(canceled.canceled).toBe(true)
  })
})
