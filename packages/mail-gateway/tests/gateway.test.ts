import { afterEach, describe, it, expect } from 'vitest'
import { encodeId, upstreamId } from '../src/index.js'
import { createHarness, type GatewayHarness } from './fixtures/harness.js'

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

describe('MailGateway normalized reads', () => {
  it('exposes a normalized session without leaking upstream credentials', async () => {
    const h = await harness()
    const session = await h.gateway.getSession(h.ctx)
    expect(session.accounts.some((account) => account.accountId === h.accountId)).toBe(true)
    expect(session.primaryAccountId).toBe(h.accountId)
    expect(session.capabilities.mail).toBe(true)
    expect(session.capabilities.submission).toBe(true)
    const serialized = JSON.stringify(session)
    expect(serialized).not.toContain(h.authorization)
    expect(serialized).not.toContain('authorization')
  })

  it('lists a normalized mailbox tree', async () => {
    const h = await harness()
    const mailboxes = await h.gateway.listMailboxes(h.ctx, h.accountId)
    expect(mailboxes).toHaveLength(7)
    const inbox = mailboxes.find((mailbox) => mailbox.role === 'inbox')
    expect(inbox).toBeDefined()
    expect(upstreamId(inbox!.id)).toBe('mb-inbox')
    expect(mailboxes.find((mailbox) => mailbox.rawRole === 'junk')?.role).toBe('spam')
  })

  it('fetches a single mailbox and missing mailboxes fail closed', async () => {
    const h = await harness()
    const mailbox = await h.gateway.getMailbox(h.ctx, h.accountId, encodeId('mbx', 'mb-sent'))
    expect(mailbox.role).toBe('sent')
    await expect(
      h.gateway.getMailbox(h.ctx, h.accountId, encodeId('mbx', 'does-not-exist')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('reports normalized account limits', async () => {
    const h = await harness()
    const account = await h.gateway.getAccount(h.ctx, h.accountId)
    expect(account.name).toBe('user@example.org')
    expect(account.limits.maxObjectsInGet).toBe(500)
    expect(account.emailQuerySortOptions).toContain('receivedAt')
  })
})

describe('MailGateway query and read', () => {
  it('queries newest-first and derives deduplicated thread order', async () => {
    const h = await harness()
    const result = await h.gateway.queryMail(h.ctx, {
      accountId: h.accountId,
      position: 0,
      limit: 50,
      calculateTotal: true,
    })
    expect(result.messageIds.map(upstreamId)).toEqual(['e3', 'e2', 'e1'])
    expect(result.threadIds.map(upstreamId)).toEqual(['t1', 't2'])
    expect(result.total).toBe(3)
    expect(result.canCalculateChanges).toBe(true)
    expect(result.queryState).toMatch(/^qs/)
  })

  it('applies normalized filters', async () => {
    const h = await harness()
    const unread = await h.gateway.queryMail(h.ctx, {
      accountId: h.accountId,
      filter: { isUnread: true },
      position: 0,
      limit: 50,
    })
    expect(unread.messageIds.map(upstreamId)).toEqual(['e1'])

    const inArchive = await h.gateway.queryMail(h.ctx, {
      accountId: h.accountId,
      filter: { inMailbox: encodeId('mbx', 'mb-archive') },
      position: 0,
      limit: 50,
    })
    expect(inArchive.messageIds).toEqual([])
  })

  it('reads a normalized message with bodies and attachments', async () => {
    const h = await harness()
    const message = await h.gateway.getEmail(h.ctx, h.accountId, encodeId('msg', 'e2'))
    expect(message.subject).toBe('Invoice 42')
    expect(message.isStarred).toBe(true)
    expect(message.isUnread).toBe(false)
    expect(message.hasAttachment).toBe(true)
    expect(message.attachments[0]?.filename).toBe('document.pdf')
    expect(message.bodyText).toBe('Hello there')
  })

  it('reads a normalized thread', async () => {
    const h = await harness()
    const thread = await h.gateway.getThread(h.ctx, h.accountId, encodeId('thd', 't1'))
    expect(thread.messageIds.map(upstreamId)).toEqual(['e1', 'e3'])
  })

  it('maps change records with normalized ids', async () => {
    const h = await harness()
    const changes = await h.gateway.getEmailChanges(h.ctx, h.accountId, 'es0')
    expect(changes.kind).toBe('email')
    expect(changes.updated.map(upstreamId).sort()).toEqual(['e1', 'e2', 'e3'])
    expect(changes.hasMoreChanges).toBe(false)

    const empty = await h.gateway.getEmailChanges(h.ctx, h.accountId, 'es1')
    expect(empty.updated).toEqual([])
  })
})

describe('MailGateway mutations', () => {
  it('marks read, exposes an undo token, and undoes', async () => {
    const h = await harness()
    const target = encodeId('msg', 'e1')
    expect((await h.gateway.getEmail(h.ctx, h.accountId, target)).isUnread).toBe(true)

    const result = await h.gateway.mutate(h.ctx, {
      accountId: h.accountId,
      idempotencyKey: 'mut-read-1',
      mutation: 'mark_read',
      targetIds: [target],
    })
    expect(result.success).toBe(true)
    expect(result.affectedCount).toBe(1)
    expect(result.undoToken).toBeDefined()
    expect((await h.gateway.getEmail(h.ctx, h.accountId, target)).isUnread).toBe(false)

    const undone = await h.gateway.undoMutation(h.ctx, result.undoToken!)
    expect(undone.undone).toBe(true)
    expect((await h.gateway.getEmail(h.ctx, h.accountId, target)).isUnread).toBe(true)
  })

  it('replays an idempotent mutation without a second upstream call', async () => {
    const h = await harness()
    const request = {
      accountId: h.accountId,
      idempotencyKey: 'mut-star-1',
      mutation: 'star' as const,
      targetIds: [encodeId('msg', 'e1')],
    }
    const first = await h.gateway.mutate(h.ctx, request)
    const callsAfterFirst = h.fixture.stats.methodCalls
    const replay = await h.gateway.mutate(h.ctx, request)
    expect(replay).toEqual(first)
    expect(h.fixture.stats.methodCalls).toBe(callsAfterFirst)
  })

  it('rejects a reused idempotency key with a different payload', async () => {
    const h = await harness()
    await h.gateway.mutate(h.ctx, {
      accountId: h.accountId,
      idempotencyKey: 'mut-conflict',
      mutation: 'star',
      targetIds: [encodeId('msg', 'e1')],
    })
    await expect(
      h.gateway.mutate(h.ctx, {
        accountId: h.accountId,
        idempotencyKey: 'mut-conflict',
        mutation: 'unstar',
        targetIds: [encodeId('msg', 'e1')],
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('archives, moves, deletes and reports missing targets', async () => {
    const h = await harness()

    await h.gateway.mutate(h.ctx, {
      accountId: h.accountId,
      idempotencyKey: 'mut-archive',
      mutation: 'archive',
      targetIds: [encodeId('msg', 'e1')],
    })
    const archived = await h.gateway.getEmail(h.ctx, h.accountId, encodeId('msg', 'e1'))
    expect(archived.mailboxIds.map(upstreamId)).not.toContain('mb-inbox')

    await h.gateway.mutate(h.ctx, {
      accountId: h.accountId,
      idempotencyKey: 'mut-move',
      mutation: 'move',
      targetIds: [encodeId('msg', 'e2')],
      destinationFolderId: encodeId('fld', 'mb-archive'),
    })
    const moved = await h.gateway.getEmail(h.ctx, h.accountId, encodeId('msg', 'e2'))
    expect(moved.mailboxIds.map(upstreamId)).toEqual(['mb-archive'])

    const deleted = await h.gateway.mutate(h.ctx, {
      accountId: h.accountId,
      idempotencyKey: 'mut-delete',
      mutation: 'delete',
      targetIds: [encodeId('msg', 'e3')],
    })
    expect(deleted.affectedCount).toBe(1)
    expect(deleted.undoToken).toBeUndefined()
    await expect(
      h.gateway.getEmail(h.ctx, h.accountId, encodeId('msg', 'e3')),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })

    await expect(
      h.gateway.mutate(h.ctx, {
        accountId: h.accountId,
        idempotencyKey: 'mut-missing',
        mutation: 'mark_read',
        targetIds: [encodeId('msg', 'nope')],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('MailGateway credential isolation', () => {
  it('never surfaces the upstream authorization when the credential is wrong', async () => {
    const h = await harness({ seedCredential: 'Basic fixture-token' })
    let captured: unknown
    try {
      await h.gateway.getSession(h.ctx)
    } catch (error) {
      captured = error
    }
    expect(captured).toMatchObject({ code: 'UNAUTHORIZED' })
    expect(JSON.stringify(captured)).not.toContain('fixture-token')
  })

  it('fails closed when no credential is registered for the session', async () => {
    const h = await harness()
    h.credentials.delete(h.sessionId)
    await expect(h.gateway.getSession(h.ctx)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})
