import { afterEach, describe, expect, it } from 'vitest'
import type { ServerResponse } from 'node:http'
import { MailApiClient } from '../src/index.js'
import {
  startHttpFixture,
  sendJson,
  type HttpFixture,
  type RecordedRequest,
} from './fixtures/http-server.js'

const fixtures: HttpFixture[] = []

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()
    if (fixture) await fixture.close()
  }
})

const mailbox = {
  id: 'mbx_inbox_1',
  folderId: 'fld_inbox_1',
  name: 'Inbox',
  parentId: null,
  role: 'inbox',
  rawRole: 'inbox',
  sortOrder: 1,
  totalEmails: 2,
  unreadEmails: 1,
  totalThreads: 2,
  unreadThreads: 1,
  isSubscribed: true,
  rights: {
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

const message = {
  id: 'msg_1',
  threadId: 'thd_1',
  mailboxIds: ['mbx_inbox_1'],
  keywords: [],
  isUnread: true,
  isStarred: false,
  isDraft: false,
  isAnswered: false,
  hasAttachment: false,
  size: 1024,
  preview: 'Hello there',
  subject: 'Welcome to Navin',
  from: [{ name: 'Sender', address: 'sender@example.org' }],
  to: [{ address: 'user@example.org' }],
  cc: [],
  bcc: [],
  replyTo: [],
  sentAt: '2026-10-01T09:00:00.000Z',
  receivedAt: '2026-10-01T09:00:05.000Z',
  bodyText: 'Hello there',
  bodyHtml: '<p>Hello there</p>',
  attachments: [],
  messageId: ['<m1@example.org>'],
  inReplyTo: null,
  references: null,
}

const sessionInfo = {
  username: 'user@example.org',
  state: 'sess1',
  accounts: [
    {
      accountId: 'acc_company_01',
      name: 'user@example.org',
      isPersonal: true,
      isReadOnly: false,
      mailCapable: true,
      submissionCapable: true,
    },
  ],
  primaryAccountId: 'acc_company_01',
  capabilities: {
    mail: true,
    submission: true,
    vacation: false,
    contacts: false,
    calendars: false,
    scheduledSend: false,
  },
  sender: { identityId: 'als_primary', address: 'user@example.org' },
}

const authSession = {
  userId: 'usr_alice',
  accountId: 'acc_company_01',
  email: 'user@example.org',
  roles: ['mail.user'],
  scopes: ['mail:read', 'mail:write', 'mail:send'],
  relyingParty: 'navin-mail',
  surface: 'mail',
  assuranceLevel: 'standard',
}

function handler(request: RecordedRequest, response: ServerResponse): void {
  switch (request.path) {
    case '/api/v1/mail/auth/login':
      sendJson(response, 200, {
        principal: {
          userId: 'usr_alice',
          accountId: 'acc_company_01',
          email: 'user@example.org',
          roles: ['mail.user'],
          scopes: ['mail:read', 'mail:write', 'mail:send'],
        },
        token: 'tok_abc',
        expiresAt: '2026-10-02T00:00:00.000Z',
      })
      return
    case '/api/v1/mail/auth/session':
      sendJson(response, 200, authSession)
      return
    case '/api/v1/mail/auth/logout':
      sendJson(response, 200, { loggedOut: true })
      return
    case '/api/v1/mail/session':
      sendJson(response, 200, sessionInfo)
      return
    case '/api/v1/mail/mailboxes':
      sendJson(response, 200, { mailboxes: [mailbox] })
      return
    case '/api/v1/mail/messages/msg_1':
      sendJson(response, 200, message)
      return
    case '/api/v1/mail/threads/thd_1':
      sendJson(response, 200, { id: 'thd_1', messageIds: ['msg_1'] })
      return
    default:
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'no route' } })
  }
}

async function createClient(): Promise<{ client: MailApiClient; fixture: HttpFixture }> {
  const fixture = await startHttpFixture(handler)
  fixtures.push(fixture)
  return { client: new MailApiClient({ baseUrl: fixture.baseUrl }), fixture }
}

describe('MailApiClient BFF surface', () => {
  it('logs in, reads the mail session and lists mailboxes over GET with query params', async () => {
    const { client, fixture } = await createClient()

    const login = await client.login({ email: 'user@example.org', password: 'secret' })
    expect(login.token).toBe('tok_abc')

    const session = await client.session()
    expect(session.surface).toBe('mail')

    const engine = await client.engineSession()
    expect(engine.primaryAccountId).toBe('acc_company_01')
    expect(engine.sender).toEqual({ identityId: 'als_primary', address: 'user@example.org' })

    const mailboxes = await client.listMailboxes('acc_company_01')
    expect(mailboxes).toHaveLength(1)
    expect(mailboxes[0]?.id).toBe('mbx_inbox_1')

    const mailboxesRequest = fixture.requestsFor('/api/v1/mail/mailboxes').at(0)
    expect(mailboxesRequest?.method).toBe('GET')
    expect(mailboxesRequest?.query.get('accountId')).toBe('acc_company_01')
    expect(mailboxesRequest?.headers['x-navin-surface']).toBe('mail')

    for (const request of fixture.requests) {
      expect(request.headers['x-navin-surface']).toBe('mail')
    }
  })

  it('fetches a message and a thread', async () => {
    const { client } = await createClient()

    const fetched = await client.getMessage('acc_company_01', 'msg_1')
    expect(fetched.subject).toBe('Welcome to Navin')

    const thread = await client.getThread('acc_company_01', 'thd_1')
    expect(thread.messageIds).toEqual(['msg_1'])
  })

  it('rejects a malformed session response instead of trusting it', async () => {
    const fixture = await startHttpFixture((_request, response) =>
      sendJson(response, 200, { username: 'user@example.org' }),
    )
    fixtures.push(fixture)
    const client = new MailApiClient({ baseUrl: fixture.baseUrl })

    await expect(client.engineSession()).rejects.toMatchObject({
      code: 'RESPONSE_VALIDATION_FAILED',
    })
  })

  it('logs out with the mail surface', async () => {
    const { client, fixture } = await createClient()
    const result = await client.logout()
    expect(result.loggedOut).toBe(true)
    expect(fixture.requestsFor('/api/v1/mail/auth/logout').at(0)?.method).toBe('POST')
  })
})
