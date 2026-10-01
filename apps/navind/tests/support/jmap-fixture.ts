import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Compact hermetic JMAP server used as the upstream engine for navind Mail BFF
 * process tests. It speaks the real HTTP boundary the gateway relies on
 * (session bootstrap, batching, state tokens, set semantics) so credential
 * isolation, capability negotiation, idempotency and error mapping are
 * exercised without contacting any real mail infrastructure.
 */

const CAP_CORE = 'urn:ietf:params:jmap:core'
const CAP_MAIL = 'urn:ietf:params:jmap:mail'
const CAP_SUBMISSION = 'urn:ietf:params:jmap:submission'

interface Mailbox {
  id: string
  name: string
  role: string | null
  sortOrder: number
}

interface Email {
  id: string
  threadId: string
  mailboxIds: Set<string>
  keywords: Set<string>
  size: number
  receivedAt: string
  subject: string
  preview: string
  from: { name: string | null; email: string }[]
  to: { name: string | null; email: string }[]
}

export interface JmapUpstream {
  readonly baseUrl: string
  readonly sessionUrl: string
  readonly accountId: string
  readonly authorization: string
  readonly emailId: string
  /** Number of submissions created upstream; proves whether a call happened. */
  submissionCount(): number
  stop(): Promise<void>
}

export interface JmapUpstreamOptions {
  authorization?: string
  accountId?: string
  username?: string
}

export async function startJmapUpstream(options: JmapUpstreamOptions = {}): Promise<JmapUpstream> {
  const accountId = options.accountId ?? 'u1'
  const username = options.username ?? 'user@example.org'
  const authorization = options.authorization ?? 'Basic dXNlckBleGFtcGxlLm9yZzpzZWNyZXQ='

  const mailboxes: Mailbox[] = [
    { id: 'mb-inbox', name: 'Inbox', role: 'inbox', sortOrder: 1 },
    { id: 'mb-archive', name: 'Archive', role: 'archive', sortOrder: 2 },
    { id: 'mb-drafts', name: 'Drafts', role: 'drafts', sortOrder: 3 },
    { id: 'mb-sent', name: 'Sent', role: 'sent', sortOrder: 4 },
    { id: 'mb-trash', name: 'Trash', role: 'trash', sortOrder: 5 },
  ]

  const emails: Email[] = [
    {
      id: 'e1',
      threadId: 't1',
      mailboxIds: new Set(['mb-inbox']),
      keywords: new Set<string>(),
      size: 1024,
      receivedAt: '2026-09-01T08:00:00.000Z',
      subject: 'Welcome to Navin',
      preview: 'Your new mail server',
      from: [{ name: 'Example Sender', email: 'welcome@example.org' }],
      to: [{ name: 'Example User', email: username }],
    },
    {
      id: 'e2',
      threadId: 't2',
      mailboxIds: new Set(['mb-inbox']),
      keywords: new Set(['$seen']),
      size: 4096,
      receivedAt: '2026-09-02T08:00:00.000Z',
      subject: 'Invoice 42',
      preview: 'Please find attached',
      from: [{ name: 'Billing', email: 'billing@example.com' }],
      to: [{ name: 'Example User', email: username }],
    },
  ]

  let emailState = 1
  const mailboxState = 1
  let submissionState = 1
  let idSeq = 100
  const submissions = new Map<string, { id: string; emailId: string; undoStatus: string }>()

  const server: Server = createServer((req, res) => {
    void handle(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  function nextId(prefix: string): string {
    idSeq += 1
    return `${prefix}${idSeq}`
  }

  function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  }

  function buildSession(): Record<string, unknown> {
    return {
      capabilities: {
        [CAP_CORE]: { maxCallsInRequest: 16, maxObjectsInGet: 500, maxObjectsInSet: 500 },
        [CAP_MAIL]: {},
        [CAP_SUBMISSION]: {},
      },
      accounts: {
        [accountId]: {
          name: username,
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities: {
            [CAP_MAIL]: {
              maxMailboxesPerEmail: null,
              maxMailboxDepth: null,
              maxSizeMailboxName: 200,
              maxSizeAttachmentsPerEmail: 50_000_000,
              emailQuerySortOptions: ['receivedAt', 'from', 'subject', 'size'],
              mayCreateTopLevelMailbox: true,
            },
            [CAP_SUBMISSION]: { maxDelayedSend: 0, submissionExtensions: {} },
          },
        },
      },
      primaryAccounts: { [CAP_MAIL]: accountId, [CAP_SUBMISSION]: accountId },
      username,
      apiUrl: `${baseUrl}/jmap/api`,
      downloadUrl: `${baseUrl}/jmap/download/{accountId}/{blobId}/{name}`,
      uploadUrl: `${baseUrl}/jmap/upload/{accountId}/`,
      eventSourceUrl: `${baseUrl}/jmap/eventsource`,
      state: 'sess1',
    }
  }

  function serializeMailbox(mailbox: Mailbox): Record<string, unknown> {
    const owned = emails.filter((email) => email.mailboxIds.has(mailbox.id))
    const unread = owned.filter((email) => !email.keywords.has('$seen'))
    const threads = new Set(owned.map((email) => email.threadId))
    const unreadThreads = new Set(unread.map((email) => email.threadId))
    return {
      id: mailbox.id,
      name: mailbox.name,
      parentId: null,
      role: mailbox.role,
      sortOrder: mailbox.sortOrder,
      totalEmails: owned.length,
      unreadEmails: unread.length,
      totalThreads: threads.size,
      unreadThreads: unreadThreads.size,
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

  function serializeEmail(email: Email): Record<string, unknown> {
    return {
      id: email.id,
      blobId: `blob-${email.id}`,
      threadId: email.threadId,
      mailboxIds: Object.fromEntries([...email.mailboxIds].map((id) => [id, true])),
      keywords: Object.fromEntries([...email.keywords].map((keyword) => [keyword, true])),
      size: email.size,
      receivedAt: email.receivedAt,
      sentAt: email.receivedAt,
      messageId: [`<${email.id}@example.invalid>`],
      inReplyTo: null,
      references: null,
      sender: null,
      from: email.from,
      to: email.to,
      cc: [],
      bcc: [],
      replyTo: [],
      subject: email.subject,
      hasAttachment: false,
      preview: email.preview,
      bodyValues: {
        text: { value: email.preview, isEncodingProblem: false, isTruncated: false },
        html: { value: `<p>${email.preview}</p>`, isEncodingProblem: false, isTruncated: false },
      },
      textBody: [
        { partId: 'text', blobId: `blob-${email.id}`, size: email.size, type: 'text/plain' },
      ],
      htmlBody: [
        { partId: 'html', blobId: `blob-${email.id}`, size: email.size, type: 'text/html' },
      ],
      attachments: [],
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', baseUrl)
    if (req.method === 'GET' && url.pathname === '/jmap/session') {
      if (!checkAuth(req, res)) return
      sendJson(res, 200, buildSession())
      return
    }
    if (req.method === 'POST' && url.pathname === '/jmap/api') {
      if (!checkAuth(req, res)) return
      const body = await readJson(req)
      sendJson(res, 200, dispatch(body))
      return
    }
    sendJson(res, 404, { type: 'notFound' })
  }

  function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.headers.authorization === authorization) return true
    res.setHeader('WWW-Authenticate', 'Basic realm="jmap"')
    sendJson(res, 401, { type: 'urn:ietf:params:jmap:error:unauthorized' })
    return false
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    if (chunks.length === 0) return {}
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  function dispatch(body: Record<string, unknown>): Record<string, unknown> {
    const calls = Array.isArray(body.methodCalls) ? body.methodCalls : []
    const methodResponses = calls.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== 3) {
        return ['error', { type: 'invalidArguments' }, 'unknown']
      }
      const [name, args, callId] = entry as [unknown, unknown, unknown]
      const callName = typeof name === 'string' ? name : ''
      const callArgs = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
      const id = typeof callId === 'string' ? callId : 'unknown'
      if (typeof callArgs.accountId !== 'string' || callArgs.accountId !== accountId) {
        return ['error', { type: 'accountNotFound' }, id]
      }
      switch (callName) {
        case 'Mailbox/get':
          return ['Mailbox/get', mailboxGet(callArgs), id]
        case 'Email/query':
          return ['Email/query', emailQuery(callArgs), id]
        case 'Email/get':
          return ['Email/get', emailGet(callArgs), id]
        case 'Email/set':
          return emailSet(callArgs, id)
        case 'Thread/get':
          return ['Thread/get', threadGet(callArgs), id]
        case 'Identity/get':
          return [
            'Identity/get',
            {
              accountId,
              state: 'ids1',
              list: [
                {
                  id: 'id1',
                  name: 'Example User',
                  email: username,
                  replyTo: null,
                  bcc: null,
                  textSignature: '',
                  htmlSignature: '',
                  mayDelete: false,
                },
              ],
              notFound: [],
            },
            id,
          ]
        case 'EmailSubmission/get':
          return [
            'EmailSubmission/get',
            {
              accountId,
              state: `sub${submissionState}`,
              list: [...submissions.values()].map((submission) => ({
                id: submission.id,
                identityId: 'id1',
                emailId: submission.emailId,
                threadId: null,
                undoStatus: submission.undoStatus,
                sendAt: null,
                undoWindowExpiresAt: null,
              })),
              notFound: [],
            },
            id,
          ]
        case 'EmailSubmission/set':
          return emailSubmissionSet(callArgs, id)
        default:
          return ['error', { type: 'unknownMethod', description: callName }, id]
      }
    })
    return { methodResponses, sessionState: 'sess1' }
  }

  function mailboxGet(args: Record<string, unknown>): Record<string, unknown> {
    const ids = args.ids
    const list =
      ids === null || ids === undefined
        ? mailboxes
        : mailboxes.filter((mailbox) => Array.isArray(ids) && ids.includes(mailbox.id))
    return {
      accountId,
      state: `mbs${mailboxState}`,
      list: list.map(serializeMailbox),
      notFound: [],
    }
  }

  function emailGet(args: Record<string, unknown>): Record<string, unknown> {
    const ids = args.ids
    const list =
      ids === null || ids === undefined
        ? emails
        : emails.filter((email) => Array.isArray(ids) && ids.includes(email.id))
    return { accountId, state: `es${emailState}`, list: list.map(serializeEmail), notFound: [] }
  }

  function matches(email: Email, filter: Record<string, unknown>): boolean {
    if (typeof filter.inMailbox === 'string' && !email.mailboxIds.has(filter.inMailbox))
      return false
    if (typeof filter.hasKeyword === 'string' && !email.keywords.has(filter.hasKeyword))
      return false
    if (typeof filter.notKeyword === 'string' && email.keywords.has(filter.notKeyword)) return false
    if (
      typeof filter.from === 'string' &&
      !email.from.some((f) => f.email.includes(filter.from as string))
    )
      return false
    if (
      typeof filter.subject === 'string' &&
      !email.subject.toLowerCase().includes((filter.subject as string).toLowerCase())
    )
      return false
    return true
  }

  function emailQuery(args: Record<string, unknown>): Record<string, unknown> {
    const filter =
      args.filter && typeof args.filter === 'object'
        ? (args.filter as Record<string, unknown>)
        : undefined
    let results = emails.filter((email) => (filter ? matches(email, filter) : true))
    results = [...results].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
    const position = typeof args.position === 'number' ? args.position : 0
    const limit = typeof args.limit === 'number' ? args.limit : results.length
    const page = results.slice(position, position + limit)
    const response: Record<string, unknown> = {
      accountId,
      queryState: `qs${emailState}`,
      canCalculateChanges: true,
      position,
      ids: page.map((email) => email.id),
    }
    if (args.calculateTotal !== false) response.total = results.length
    return response
  }

  function emailSet(args: Record<string, unknown>, callId: string): unknown[] {
    if (typeof args.ifInState === 'string' && args.ifInState !== `es${emailState}`) {
      return ['error', { type: 'stateMismatch' }, callId]
    }
    const created: Record<string, unknown> = {}
    const updated: Record<string, unknown> = {}
    const notUpdated: Record<string, unknown> = {}
    const createMap = args.create
    if (createMap && typeof createMap === 'object') {
      for (const [creationId, value] of Object.entries(createMap as Record<string, unknown>)) {
        const create = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
        const mailboxIds =
          create.mailboxIds && typeof create.mailboxIds === 'object'
            ? Object.keys(create.mailboxIds as Record<string, unknown>)
            : []
        const id = nextId('e')
        const record: Email = {
          id,
          threadId: nextId('t'),
          mailboxIds: new Set(mailboxIds.length > 0 ? mailboxIds : ['mb-drafts']),
          keywords: new Set(['$draft']),
          size: 128,
          receivedAt: new Date().toISOString(),
          subject: typeof create.subject === 'string' ? create.subject : '',
          preview: '',
          from: [],
          to: [],
        }
        emails.push(record)
        emailState += 1
        created[creationId] = serializeEmail(record)
      }
    }
    const updateMap = args.update
    if (updateMap && typeof updateMap === 'object') {
      for (const [emailId, patch] of Object.entries(updateMap as Record<string, unknown>)) {
        const email = emails.find((entry) => entry.id === emailId)
        if (!email) {
          notUpdated[emailId] = { type: 'notFound' }
          continue
        }
        if (patch && typeof patch === 'object') {
          for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
            if (key.startsWith('keywords/')) {
              const keyword = key.slice('keywords/'.length)
              if (value === true) email.keywords.add(keyword)
              else email.keywords.delete(keyword)
            } else if (key.startsWith('mailboxIds/')) {
              const mailboxId = key.slice('mailboxIds/'.length)
              if (value === true) email.mailboxIds.add(mailboxId)
              else email.mailboxIds.delete(mailboxId)
            }
          }
        }
        updated[emailId] = null
      }
      if (Object.keys(updated).length > 0) emailState += 1
    }
    return [
      'Email/set',
      {
        accountId,
        oldState: `es${emailState - 1}`,
        newState: `es${emailState}`,
        created: Object.keys(created).length > 0 ? created : null,
        updated: Object.keys(updated).length > 0 ? updated : null,
        destroyed: null,
        notCreated: null,
        notUpdated: Object.keys(notUpdated).length > 0 ? notUpdated : null,
        notDestroyed: null,
      },
      callId,
    ]
  }

  function threadGet(args: Record<string, unknown>): Record<string, unknown> {
    const threads = new Map<string, string[]>()
    for (const email of emails) {
      const list = threads.get(email.threadId) ?? []
      list.push(email.id)
      threads.set(email.threadId, list)
    }
    const ids = args.ids
    const wanted = Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string')
      : [...threads.keys()]
    return {
      accountId,
      state: `ts${emailState}`,
      list: wanted
        .filter((id) => threads.has(id))
        .map((id) => ({ id, emailIds: threads.get(id) ?? [] })),
      notFound: [],
    }
  }

  function emailSubmissionSet(args: Record<string, unknown>, callId: string): unknown[] {
    if (typeof args.ifInState === 'string' && args.ifInState !== `sub${submissionState}`) {
      return ['error', { type: 'stateMismatch' }, callId]
    }
    const created: Record<string, unknown> = {}
    const notCreated: Record<string, unknown> = {}
    const createMap = args.create
    if (createMap && typeof createMap === 'object') {
      for (const [creationId, value] of Object.entries(createMap as Record<string, unknown>)) {
        const create = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
        const emailId = typeof create.emailId === 'string' ? create.emailId : undefined
        if (!emailId || !emails.some((email) => email.id === emailId)) {
          notCreated[creationId] = { type: 'invalidProperties', description: 'unknown emailId' }
          continue
        }
        const id = nextId('s')
        submissions.set(id, { id, emailId, undoStatus: 'final' })
        submissionState += 1
        created[creationId] = {
          id,
          identityId: 'id1',
          emailId,
          threadId: null,
          undoStatus: 'final',
          sendAt: null,
          undoWindowExpiresAt: null,
        }
      }
    }
    return [
      'EmailSubmission/set',
      {
        accountId,
        oldState: `sub${submissionState - 1}`,
        newState: `sub${submissionState}`,
        created: Object.keys(created).length > 0 ? created : null,
        updated: null,
        destroyed: null,
        notCreated: Object.keys(notCreated).length > 0 ? notCreated : null,
        notUpdated: null,
        notDestroyed: null,
      },
      callId,
    ]
  }

  return {
    baseUrl,
    sessionUrl: `${baseUrl}/jmap/session`,
    accountId,
    authorization,
    emailId: 'e1',
    submissionCount: () => submissions.size,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
