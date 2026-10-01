import { describe, it, expect } from 'vitest'
import type { MailMutationRequest, StandardMutationType } from '@navin/contracts'
import {
  buildEmailQueryFilter,
  buildEmailQuerySort,
  encodeId,
  decodeId,
  upstreamId,
  normalizeMailboxRole,
  toNormalizedMailbox,
  toNormalizedEmail,
  toNormalizedThread,
  toNormalizedChanges,
  planEmailSetMutation,
  planSubmissionStatus,
  toEngineDescriptor,
  readGatewayCapabilities,
  GatewayError,
  JMAP_MAIL,
  JMAP_SUBMISSION,
  type JmapEmail,
  type JmapMailbox,
  type JmapSession,
} from '../src/index.js'

function makeEmail(overrides: Partial<JmapEmail> = {}): JmapEmail {
  return {
    id: 'e1',
    blobId: 'blob-e1',
    threadId: 't1',
    mailboxIds: { 'mb-inbox': true },
    keywords: { $seen: true, $flagged: true },
    size: 2048,
    receivedAt: '2026-09-01T10:00:00.000Z',
    messageId: ['<e1@example.org>'],
    inReplyTo: null,
    references: null,
    sender: null,
    from: [{ name: 'Partner', email: 'partner@example.org' }],
    to: [{ name: null, email: 'user@example.org' }],
    cc: null,
    bcc: null,
    replyTo: null,
    subject: 'Invoice 42',
    sentAt: '2026-09-01T09:59:00.000Z',
    hasAttachment: true,
    preview: 'Please find attached',
    bodyValues: { text: { value: 'Body text', isEncodingProblem: false, isTruncated: false } },
    textBody: [
      {
        partId: 'text',
        blobId: 'blob-e1',
        size: 9,
        name: null,
        type: 'text/plain',
        charset: 'utf-8',
        disposition: null,
        cid: null,
      },
    ],
    htmlBody: [],
    attachments: [
      {
        partId: 'a1',
        blobId: 'blob-a1',
        size: 100,
        name: 'spec.pdf',
        type: 'application/pdf',
        charset: null,
        disposition: 'attachment',
        cid: null,
      },
    ],
    ...overrides,
  }
}

function makeMailbox(id: string, role: string | null): JmapMailbox {
  return {
    id,
    name: id,
    parentId: null,
    role,
    sortOrder: 1,
    totalEmails: 0,
    unreadEmails: 0,
    totalThreads: 0,
    unreadThreads: 0,
    isSubscribed: true,
    myRights: {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      mayCreateChild: true,
      mayRename: true,
      mayDelete: true,
      maySubmit: true,
    },
  }
}

describe('id codec', () => {
  it('round-trips upstream identifiers through contract-safe prefixes', () => {
    const encoded = encodeId('mbx', 'mb-inbox')
    expect(encoded).toMatch(/^mbx_[a-zA-Z0-9._-]+$/)
    expect(upstreamId(encoded)).toBe('mb-inbox')
  })

  it('allows mailbox and folder aliases to decode to the same upstream id', () => {
    const asMailbox = encodeId('mbx', 'mb-inbox')
    const asFolder = encodeId('fld', 'mb-inbox')
    expect(decodeId(asMailbox).prefix).toBe('mbx')
    expect(decodeId(asFolder).prefix).toBe('fld')
    expect(upstreamId(asMailbox)).toBe(upstreamId(asFolder))
  })

  it('rejects malformed and over-long identifiers', () => {
    expect(() => upstreamId('nope')).toThrow(GatewayError)
    expect(() => upstreamId('zzz_abcd')).toThrow(GatewayError)
    expect(() => upstreamId('mbx_@@@@')).toThrow(GatewayError)
    expect(() => encodeId('acc', 'x'.repeat(200))).toThrow(GatewayError)
  })
})

describe('mailbox mapping', () => {
  it('maps JMAP roles to normalized roles including the junk/spam alias', () => {
    expect(normalizeMailboxRole('junk')).toBe('spam')
    expect(normalizeMailboxRole('inbox')).toBe('inbox')
    expect(normalizeMailboxRole(null)).toBe('custom')
  })

  it('projects a mailbox with normalized and folder ids', () => {
    const normalized = toNormalizedMailbox(makeMailbox('mb-inbox', 'inbox'))
    expect(normalized.role).toBe('inbox')
    expect(upstreamId(normalized.id)).toBe('mb-inbox')
    expect(upstreamId(normalized.folderId)).toBe('mb-inbox')
    expect(normalized.rights.maySetKeywords).toBe(true)
  })
})

describe('email and thread mapping', () => {
  it('normalizes keywords, addresses, bodies and attachments', () => {
    const normalized = toNormalizedEmail(makeEmail())
    expect(normalized.isUnread).toBe(false)
    expect(normalized.isStarred).toBe(true)
    expect(normalized.hasAttachment).toBe(true)
    expect(normalized.from[0]?.address).toBe('partner@example.org')
    expect(normalized.bodyText).toBe('Body text')
    expect(normalized.attachments[0]?.filename).toBe('spec.pdf')
    expect(upstreamId(normalized.id)).toBe('e1')
    expect(upstreamId(normalized.threadId)).toBe('t1')
  })

  it('drops addresses that violate the RFC address pattern', () => {
    const normalized = toNormalizedEmail(
      makeEmail({ from: [{ name: 'Bad', email: 'not-an-email' }] }),
    )
    expect(normalized.from).toEqual([])
  })

  it('maps threads preserving message order', () => {
    const normalized = toNormalizedThread({ id: 't1', emailIds: ['e1', 'e3'] })
    expect(normalized.messageIds.map(upstreamId)).toEqual(['e1', 'e3'])
  })
})

describe('query mapping', () => {
  it('builds an AND filter with decoded mailbox and keyword conditions', () => {
    const filter = buildEmailQueryFilter({
      inMailbox: encodeId('mbx', 'mb-inbox'),
      text: 'invoice',
      isUnread: true,
    })
    expect(filter).toEqual({
      operator: 'AND',
      conditions: [{ inMailbox: 'mb-inbox' }, { text: 'invoice' }, { notKeyword: '$seen' }],
    })
  })

  it('collapses a single condition and defaults sort to newest first', () => {
    expect(buildEmailQueryFilter({ isStarred: true })).toEqual({ hasKeyword: '$flagged' })
    expect(buildEmailQuerySort(undefined)).toEqual([{ property: 'receivedAt', isAscending: false }])
  })

  it('rejects sort fields the engine does not support', () => {
    expect(() =>
      buildEmailQuerySort([{ field: 'size', direction: 'asc' }], ['receivedAt']),
    ).toThrow(GatewayError)
  })
})

describe('mutation planning', () => {
  const mailboxes = [
    makeMailbox('mb-inbox', 'inbox'),
    makeMailbox('mb-trash', 'trash'),
    makeMailbox('mb-archive', 'archive'),
  ]

  const standard = (
    mutation: StandardMutationType,
    targetIds = ['msg_e1'],
  ): MailMutationRequest => ({
    accountId: 'acc_u1',
    idempotencyKey: 'key-1',
    mutation,
    targetIds,
  })

  it('maps flag mutations to keyword patches', () => {
    const plan = planEmailSetMutation({
      mutation: standard('mark_read'),
      targets: [{ upstreamId: 'e1', email: makeEmail() }],
      mailboxes,
    })
    expect(plan.update['e1']).toEqual({ 'keywords/$seen': true })
    expect(plan.affected).toBe(1)
  })

  it('trash removes other mailboxes and adds trash', () => {
    const plan = planEmailSetMutation({
      mutation: standard('trash'),
      targets: [{ upstreamId: 'e1', email: makeEmail({ mailboxIds: { 'mb-inbox': true } }) }],
      mailboxes,
    })
    expect(plan.update['e1']).toEqual({ 'mailboxIds/mb-inbox': null, 'mailboxIds/mb-trash': true })
  })

  it('move keeps only the destination folder', () => {
    const plan = planEmailSetMutation({
      mutation: {
        accountId: 'acc_u1',
        idempotencyKey: 'key-2',
        mutation: 'move',
        targetIds: ['msg_e1'],
        destinationFolderId: encodeId('fld', 'mb-archive'),
      },
      targets: [
        {
          upstreamId: 'e1',
          email: makeEmail({ mailboxIds: { 'mb-inbox': true, 'mb-archive': true } }),
        },
      ],
      mailboxes,
    })
    expect(plan.update['e1']).toEqual({
      'mailboxIds/mb-inbox': null,
      'mailboxIds/mb-archive': true,
    })
  })

  it('delete plans destruction instead of a patch', () => {
    const plan = planEmailSetMutation({
      mutation: standard('delete', ['msg_e1', 'msg_e2']),
      targets: [
        { upstreamId: 'e1', email: makeEmail() },
        { upstreamId: 'e2', email: makeEmail({ id: 'e2' }) },
      ],
      mailboxes,
    })
    expect(plan.destroy).toEqual(['e1', 'e2'])
    expect(plan.update).toEqual({})
  })
})

describe('submission status planning', () => {
  const base = {
    accountId: 'acc_u1',
    senderIdentityId: 'als_id-1',
    idempotencyKey: 'key-1',
    from: { address: 'user@example.org' },
    to: [{ address: 'partner@example.org' }],
    subject: 'Hi',
  }

  it('returns sent immediately without scheduling', () => {
    const plan = planSubmissionStatus(base, Date.now(), true)
    expect(plan.status).toBe('sent')
    expect(plan.useScheduledSendExtension).toBe(false)
  })

  it('holds for undo when a delay is requested', () => {
    const now = Date.parse('2026-10-01T00:00:00.000Z')
    const plan = planSubmissionStatus({ ...base, undoDelaySeconds: 10 }, now, true)
    expect(plan.status).toBe('held_for_undo')
    expect(plan.undoWindowExpiresAt).toBe('2026-10-01T00:00:10.000Z')
  })

  it('fails closed for scheduled send when the capability is absent', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(() => planSubmissionStatus({ ...base, sendAt: future }, Date.now(), false)).toThrow(
      GatewayError,
    )
    const plan = planSubmissionStatus({ ...base, sendAt: future }, Date.now(), true)
    expect(plan.status).toBe('scheduled')
  })
})

describe('changes and capabilities mapping', () => {
  it('prefixes change ids by kind', () => {
    const changes = toNormalizedChanges(
      {
        accountId: 'u1',
        oldState: 'es1',
        newState: 'es2',
        hasMoreChanges: false,
        created: ['e9'],
        updated: ['e1'],
        destroyed: ['e2'],
      },
      'acc_u1',
      'email',
    )
    expect(changes.created.map(upstreamId)).toEqual(['e9'])
    expect(changes.updated.map(upstreamId)).toEqual(['e1'])
  })

  it('projects capabilities into an engine descriptor', () => {
    const session: JmapSession = {
      capabilities: { 'urn:ietf:params:jmap:core': { maxCallsInRequest: 16 }, [JMAP_MAIL]: {} },
      accounts: {
        u1: { name: 'u1', isPersonal: true, isReadOnly: false, accountCapabilities: {} },
      },
      primaryAccounts: { [JMAP_MAIL]: 'u1' },
      username: 'u1',
      apiUrl: 'https://mail.example.org/jmap',
      downloadUrl: '',
      uploadUrl: '',
      eventSourceUrl: '',
      state: 's1',
    }
    const caps = readGatewayCapabilities(session)
    expect(caps.mail).toBe(true)
    expect(caps.submission).toBe(false)
    const descriptor = toEngineDescriptor(caps, {
      engineId: 'stalwart',
      displayName: 'Stalwart',
      version: '1',
      endpoint: 'https://mail.example.org/jmap',
    })
    expect(descriptor.protocols.jmap).toBe(true)
    expect(descriptor.protocols.smtpSubmission).toBe(false)
    expect(descriptor.features.tlsEnforcement).toBe(true)
    expect(JMAP_SUBMISSION).toContain('submission')
  })
})
