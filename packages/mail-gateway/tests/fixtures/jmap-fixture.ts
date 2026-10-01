import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Minimal in-process JMAP server used as a hermetic fixture for gateway tests.
 *
 * It implements only the RFC 8620 / 8621 behaviours the gateway relies on and
 * is intentionally strict: unknown capabilities, missing auth, state mismatches
 * and unknown methods all produce protocol-accurate errors so the gateway's
 * error/state/capability mapping is exercised against a real HTTP boundary.
 */

export const CAP_CORE = 'urn:ietf:params:jmap:core'
export const CAP_MAIL = 'urn:ietf:params:jmap:mail'
export const CAP_SUBMISSION = 'urn:ietf:params:jmap:submission'
export const CAP_SCHEDULED_SEND = 'urn:example:params:scheduled-send'

export interface FixtureMailbox {
  id: string
  name: string
  parentId: string | null
  role: string | null
  sortOrder: number
  isSubscribed: boolean
}

export interface FixtureEmail {
  id: string
  threadId: string
  blobId: string
  mailboxIds: Set<string>
  keywords: Set<string>
  size: number
  receivedAt: string
  sentAt: string
  from: { name: string | null; email: string }[]
  to: { name: string | null; email: string }[]
  cc: { name: string | null; email: string }[]
  bcc: { name: string | null; email: string }[]
  replyTo: { name: string | null; email: string }[]
  subject: string
  preview: string
  messageId: string[]
  hasAttachment: boolean
  bodyText: string | null
  bodyHtml: string | null
}

export interface FixtureIdentity {
  id: string
  name: string
  email: string
}

export interface FixtureSubmission {
  id: string
  identityId: string
  emailId: string
  undoStatus: 'pending' | 'final' | 'canceled'
  undoWindowExpiresAt: string | null
  sendAt: string | null
}

export interface FixtureOptions {
  authorization?: string
  accountId?: string
  username?: string
  capabilities?: string[]
  mailboxes?: FixtureMailbox[]
  emails?: FixtureEmail[]
  identities?: FixtureIdentity[]
  latencyMs?: number
  apiStatus?: number
  apiStatusType?: string
}

export interface FixtureStats {
  sessionRequests: number
  apiRequests: number
  methodCalls: number
}

function defaultMailboxes(): FixtureMailbox[] {
  return [
    {
      id: 'mb-inbox',
      name: 'Inbox',
      parentId: null,
      role: 'inbox',
      sortOrder: 1,
      isSubscribed: true,
    },
    {
      id: 'mb-archive',
      name: 'Archive',
      parentId: null,
      role: 'archive',
      sortOrder: 2,
      isSubscribed: true,
    },
    {
      id: 'mb-drafts',
      name: 'Drafts',
      parentId: null,
      role: 'drafts',
      sortOrder: 3,
      isSubscribed: true,
    },
    { id: 'mb-sent', name: 'Sent', parentId: null, role: 'sent', sortOrder: 4, isSubscribed: true },
    {
      id: 'mb-trash',
      name: 'Trash',
      parentId: null,
      role: 'trash',
      sortOrder: 5,
      isSubscribed: true,
    },
    { id: 'mb-junk', name: 'Junk', parentId: null, role: 'junk', sortOrder: 6, isSubscribed: true },
    {
      id: 'mb-labels',
      name: 'Labels',
      parentId: null,
      role: null,
      sortOrder: 7,
      isSubscribed: true,
    },
  ]
}

function email(
  partial: Partial<FixtureEmail> & Pick<FixtureEmail, 'id' | 'threadId'>,
): FixtureEmail {
  return {
    blobId: `blob-${partial.id}`,
    mailboxIds: new Set(['mb-inbox']),
    keywords: new Set<string>(),
    size: 1024,
    receivedAt: '2026-09-01T10:00:00.000Z',
    sentAt: '2026-09-01T09:59:00.000Z',
    from: [{ name: 'Partner', email: 'partner@example.org' }],
    to: [{ name: 'Example User', email: 'user@example.org' }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: 'Hello',
    preview: 'Hello there',
    messageId: [`<${partial.id}@example.org>`],
    hasAttachment: false,
    bodyText: 'Hello there',
    bodyHtml: '<p>Hello there</p>',
    ...partial,
  }
}

function defaultEmails(): FixtureEmail[] {
  return [
    email({
      id: 'e1',
      threadId: 't1',
      subject: 'Welcome to Navin',
      preview: 'Your new mail server',
      from: [{ name: 'Example Sender', email: 'welcome@example.org' }],
      receivedAt: '2026-09-01T08:00:00.000Z',
      mailboxIds: new Set(['mb-inbox']),
      keywords: new Set<string>(),
    }),
    email({
      id: 'e2',
      threadId: 't2',
      subject: 'Invoice 42',
      preview: 'Please find attached',
      from: [{ name: 'Billing', email: 'billing@example.com' }],
      receivedAt: '2026-09-02T08:00:00.000Z',
      mailboxIds: new Set(['mb-inbox']),
      keywords: new Set(['$seen', '$flagged']),
      hasAttachment: true,
      size: 4096,
    }),
    email({
      id: 'e3',
      threadId: 't1',
      subject: 'Re: Welcome to Navin',
      preview: 'Thanks for signing up',
      receivedAt: '2026-09-03T08:00:00.000Z',
      mailboxIds: new Set(['mb-inbox']),
      keywords: new Set(['$seen']),
    }),
  ]
}

interface MethodCall {
  name: string
  args: Record<string, unknown>
  callId: string
}

export class JmapFixture {
  readonly stats: FixtureStats = { sessionRequests: 0, apiRequests: 0, methodCalls: 0 }
  readonly accountId: string
  readonly mailboxes: FixtureMailbox[]
  readonly emails: FixtureEmail[]
  readonly identities: FixtureIdentity[]
  readonly submissions = new Map<string, FixtureSubmission>()
  private readonly capabilities: string[]
  private readonly authorization: string | undefined
  private readonly username: string
  private readonly latencyMs: number
  private readonly apiStatus: number | undefined
  private readonly apiStatusType: string
  private readonly server: Server
  private baseUrl = ''
  private idSeq = 100
  private emailState = 1
  private mailboxState = 1
  private sessionState = 1
  private submissionState = 1

  constructor(options: FixtureOptions) {
    this.accountId = options.accountId ?? 'u1'
    this.username = options.username ?? 'user@example.org'
    this.authorization = options.authorization
    this.capabilities = options.capabilities ?? [
      CAP_CORE,
      CAP_MAIL,
      CAP_SUBMISSION,
      CAP_SCHEDULED_SEND,
    ]
    this.mailboxes = options.mailboxes ?? defaultMailboxes()
    this.emails = options.emails ?? defaultEmails()
    this.identities = options.identities ?? [
      { id: 'id-1', name: 'Example User', email: 'user@example.org' },
    ]
    this.latencyMs = options.latencyMs ?? 0
    this.apiStatus = options.apiStatus
    this.apiStatusType = options.apiStatusType ?? 'serverUnavailable'
    this.server = createServer((req, res) => {
      void this.handle(req, res)
    })
  }

  async start(): Promise<JmapFixture> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    const address = this.server.address() as AddressInfo
    this.baseUrl = `http://127.0.0.1:${address.port}`
    return this
  }

  get sessionUrl(): string {
    return `${this.baseUrl}/jmap/session`
  }

  get apiUrl(): string {
    return `${this.baseUrl}/jmap/api`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    )
  }

  private nextId(prefix: string): string {
    this.idSeq += 1
    return `${prefix}${this.idSeq}`
  }

  private buildSession(): Record<string, unknown> {
    const capabilities: Record<string, unknown> = {}
    if (this.capabilities.includes(CAP_CORE)) {
      capabilities[CAP_CORE] = {
        maxSizeUpload: 50_000_000,
        maxConcurrentUpload: 4,
        maxSizeRequest: 10_000_000,
        maxConcurrentRequests: 4,
        maxCallsInRequest: 16,
        maxObjectsInGet: 500,
        maxObjectsInSet: 500,
        collationAlgorithms: ['i;ascii-numeric', 'i;unicode-casemap'],
      }
    }
    if (this.capabilities.includes(CAP_MAIL)) capabilities[CAP_MAIL] = {}
    if (this.capabilities.includes(CAP_SUBMISSION)) capabilities[CAP_SUBMISSION] = {}
    if (this.capabilities.includes(CAP_SCHEDULED_SEND)) capabilities[CAP_SCHEDULED_SEND] = {}

    const accountCapabilities: Record<string, unknown> = {}
    if (this.capabilities.includes(CAP_MAIL)) {
      accountCapabilities[CAP_MAIL] = {
        maxMailboxesPerEmail: null,
        maxMailboxDepth: null,
        maxSizeMailboxName: 200,
        maxSizeAttachmentsPerEmail: 50_000_000,
        emailQuerySortOptions: ['receivedAt', 'from', 'subject', 'size'],
        mayCreateTopLevelMailbox: true,
      }
    }
    if (this.capabilities.includes(CAP_SUBMISSION)) {
      accountCapabilities[CAP_SUBMISSION] = { maxDelayedSend: 0, submissionExtensions: {} }
    }

    return {
      capabilities,
      accounts: {
        [this.accountId]: {
          name: this.username,
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities,
        },
      },
      primaryAccounts: {
        ...(this.capabilities.includes(CAP_MAIL) ? { [CAP_MAIL]: this.accountId } : {}),
        ...(this.capabilities.includes(CAP_SUBMISSION) ? { [CAP_SUBMISSION]: this.accountId } : {}),
      },
      username: this.username,
      apiUrl: this.apiUrl,
      downloadUrl: `${this.baseUrl}/jmap/download/{accountId}/{blobId}/{name}`,
      uploadUrl: `${this.baseUrl}/jmap/upload/{accountId}/`,
      eventSourceUrl: `${this.baseUrl}/jmap/eventsource`,
      state: `sess${this.sessionState}`,
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs))

    const url = new URL(req.url ?? '/', this.baseUrl)

    if (req.method === 'GET' && url.pathname === '/jmap/session') {
      this.stats.sessionRequests += 1
      if (!this.checkAuth(req, res)) return
      this.sendJson(res, 200, this.buildSession())
      return
    }

    if (req.method === 'POST' && url.pathname === '/jmap/api') {
      this.stats.apiRequests += 1
      if (!this.checkAuth(req, res)) return
      if (this.apiStatus) {
        this.sendJson(res, this.apiStatus, {
          type: `urn:ietf:params:jmap:error:${this.apiStatusType}`,
          detail: 'Injected fixture failure',
        })
        return
      }
      const body = await this.readJson(req)
      this.sendJson(res, 200, this.dispatchApi(body))
      return
    }

    this.sendJson(res, 404, { type: 'notFound' })
  }

  private checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
    if (!this.authorization) return true
    if (req.headers.authorization === this.authorization) return true
    res.setHeader('WWW-Authenticate', 'Basic realm="jmap"')
    this.sendJson(res, 401, {
      type: 'urn:ietf:params:jmap:error:unauthorized',
      detail: 'Unauthorized',
    })
    return false
  }

  private async readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
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

  private sendJson(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  }

  private dispatchApi(body: Record<string, unknown>): Record<string, unknown> {
    const using = Array.isArray(body.using)
      ? (body.using as unknown[]).filter((u): u is string => typeof u === 'string')
      : []
    const unknown = using.filter((uri) => !this.capabilities.includes(uri))
    if (unknown.length > 0) {
      // Request-level error surfaces via HTTP 400 in a real server; the gateway
      // cannot change `using`, so this is a guard for the fixture itself.
      return {
        methodResponses: [
          ['error', { type: 'unknownCapability', description: unknown.join(',') }, 'c0'],
        ],
        sessionState: `sess${this.sessionState}`,
      }
    }

    const rawCalls = Array.isArray(body.methodCalls) ? body.methodCalls : []
    const methodResponses = rawCalls.map((entry) => {
      this.stats.methodCalls += 1
      if (!Array.isArray(entry) || entry.length !== 3) {
        return ['error', { type: 'invalidArguments' }, 'unknown']
      }
      const [name, args, callId] = entry as [unknown, unknown, unknown]
      const call: MethodCall = {
        name: typeof name === 'string' ? name : '',
        args: args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
        callId: typeof callId === 'string' ? callId : 'unknown',
      }
      return this.dispatchCall(call)
    })

    return { methodResponses, sessionState: `sess${this.sessionState}` }
  }

  private dispatchCall(call: MethodCall): unknown[] {
    const account = call.args['accountId']
    if (typeof account !== 'string' || account !== this.accountId) {
      return ['error', { type: 'accountNotFound' }, call.callId]
    }
    switch (call.name) {
      case 'Mailbox/get':
        return ['Mailbox/get', this.mailboxGet(call.args), call.callId]
      case 'Email/get':
        return ['Email/get', this.emailGet(call.args), call.callId]
      case 'Email/query':
        return ['Email/query', this.emailQuery(call.args), call.callId]
      case 'Email/set':
        return this.emailSet(call)
      case 'Email/changes':
        return ['Email/changes', this.emailChanges(call.args), call.callId]
      case 'Thread/get':
        return ['Thread/get', this.threadGet(call.args), call.callId]
      case 'Identity/get':
        return ['Identity/get', this.identityGet(call.args), call.callId]
      case 'EmailSubmission/get':
        return ['EmailSubmission/get', this.submissionGet(call.args), call.callId]
      case 'EmailSubmission/set':
        return this.submissionSet(call)
      default:
        return ['error', { type: 'unknownMethod', description: call.name }, call.callId]
    }
  }

  private serializeMailbox(mailbox: FixtureMailbox): Record<string, unknown> {
    const emails = this.emails.filter((entry) => entry.mailboxIds.has(mailbox.id))
    const unread = emails.filter((entry) => !entry.keywords.has('$seen'))
    const threads = new Set(emails.map((entry) => entry.threadId))
    const unreadThreads = new Set(unread.map((entry) => entry.threadId))
    return {
      id: mailbox.id,
      name: mailbox.name,
      parentId: mailbox.parentId,
      role: mailbox.role,
      sortOrder: mailbox.sortOrder,
      totalEmails: emails.length,
      unreadEmails: unread.length,
      totalThreads: threads.size,
      unreadThreads: unreadThreads.size,
      isSubscribed: mailbox.isSubscribed,
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

  private mailboxGet(args: Record<string, unknown>): Record<string, unknown> {
    const ids = args['ids']
    const list =
      ids === null || ids === undefined
        ? this.mailboxes
        : this.mailboxes.filter((mailbox) => Array.isArray(ids) && ids.includes(mailbox.id))
    const notFound = Array.isArray(ids)
      ? ids.filter(
          (id) => typeof id === 'string' && !this.mailboxes.some((mailbox) => mailbox.id === id),
        )
      : []
    return {
      accountId: this.accountId,
      state: `mbs${this.mailboxState}`,
      list: list.map((m) => this.serializeMailbox(m)),
      notFound,
    }
  }

  private serializeEmail(record: FixtureEmail): Record<string, unknown> {
    return {
      id: record.id,
      blobId: record.blobId,
      threadId: record.threadId,
      mailboxIds: Object.fromEntries([...record.mailboxIds].map((id) => [id, true])),
      keywords: Object.fromEntries([...record.keywords].map((keyword) => [keyword, true])),
      size: record.size,
      receivedAt: record.receivedAt,
      sentAt: record.sentAt,
      messageId: record.messageId,
      inReplyTo: null,
      references: null,
      sender: null,
      from: record.from,
      to: record.to,
      cc: record.cc,
      bcc: record.bcc,
      replyTo: record.replyTo,
      subject: record.subject,
      hasAttachment: record.hasAttachment,
      preview: record.preview,
      bodyValues: {
        text: { value: record.bodyText ?? '', isEncodingProblem: false, isTruncated: false },
        ...(record.bodyHtml
          ? { html: { value: record.bodyHtml, isEncodingProblem: false, isTruncated: false } }
          : {}),
      },
      textBody: [
        {
          partId: 'text',
          blobId: record.blobId,
          size: record.size,
          name: null,
          type: 'text/plain',
          charset: 'utf-8',
          disposition: null,
          cid: null,
        },
      ],
      htmlBody: record.bodyHtml
        ? [
            {
              partId: 'html',
              blobId: record.blobId,
              size: record.size,
              name: null,
              type: 'text/html',
              charset: 'utf-8',
              disposition: null,
              cid: null,
            },
          ]
        : [],
      attachments: record.hasAttachment
        ? [
            {
              partId: 'att-1',
              blobId: `${record.blobId}-att`,
              size: 2048,
              name: 'document.pdf',
              type: 'application/pdf',
              charset: null,
              disposition: 'attachment',
              cid: null,
            },
          ]
        : [],
    }
  }

  private emailGet(args: Record<string, unknown>): Record<string, unknown> {
    const ids = args['ids']
    const list =
      ids === null || ids === undefined
        ? this.emails
        : this.emails.filter((record) => Array.isArray(ids) && ids.includes(record.id))
    const notFound = Array.isArray(ids)
      ? ids.filter(
          (id) => typeof id === 'string' && !this.emails.some((record) => record.id === id),
        )
      : []
    return {
      accountId: this.accountId,
      state: `es${this.emailState}`,
      list: list.map((r) => this.serializeEmail(r)),
      notFound,
    }
  }

  private matchesFilter(record: FixtureEmail, filter: Record<string, unknown>): boolean {
    const operator = filter['operator']
    if (operator === 'AND' || operator === 'OR') {
      const conditions = Array.isArray(filter['conditions'])
        ? (filter['conditions'] as Record<string, unknown>[])
        : []
      const results = conditions.map((condition) => this.matchesFilter(record, condition))
      return operator === 'AND' ? results.every(Boolean) : results.some(Boolean)
    }
    if (typeof filter['inMailbox'] === 'string' && !record.mailboxIds.has(filter['inMailbox']))
      return false
    if (typeof filter['from'] === 'string') {
      const needle = filter['from'].toLowerCase()
      if (!record.from.some((entry) => entry.email.toLowerCase().includes(needle))) return false
    }
    if (typeof filter['to'] === 'string') {
      const needle = filter['to'].toLowerCase()
      if (!record.to.some((entry) => entry.email.toLowerCase().includes(needle))) return false
    }
    if (
      typeof filter['subject'] === 'string' &&
      !record.subject.toLowerCase().includes(filter['subject'].toLowerCase())
    )
      return false
    if (typeof filter['text'] === 'string') {
      const needle = filter['text'].toLowerCase()
      const haystack = [
        record.subject,
        record.preview,
        record.bodyText ?? '',
        ...record.from.map((e) => e.email),
        ...record.to.map((e) => e.email),
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    if (
      typeof filter['hasAttachment'] === 'boolean' &&
      record.hasAttachment !== filter['hasAttachment']
    )
      return false
    if (typeof filter['hasKeyword'] === 'string' && !record.keywords.has(filter['hasKeyword']))
      return false
    if (typeof filter['notKeyword'] === 'string' && record.keywords.has(filter['notKeyword']))
      return false
    if (
      typeof filter['before'] === 'string' &&
      Date.parse(record.receivedAt) >= Date.parse(filter['before'])
    )
      return false
    if (
      typeof filter['after'] === 'string' &&
      Date.parse(record.receivedAt) <= Date.parse(filter['after'])
    )
      return false
    if (typeof filter['minSize'] === 'number' && record.size < filter['minSize']) return false
    if (typeof filter['maxSize'] === 'number' && record.size > filter['maxSize']) return false
    return true
  }

  private emailQuery(args: Record<string, unknown>): Record<string, unknown> {
    const filter =
      args['filter'] && typeof args['filter'] === 'object'
        ? (args['filter'] as Record<string, unknown>)
        : undefined
    let records = this.emails.filter((record) =>
      filter ? this.matchesFilter(record, filter) : true,
    )

    const sort = Array.isArray(args['sort']) ? (args['sort'] as Record<string, unknown>[]) : []
    const spec = sort[0]
    if (spec && typeof spec['property'] === 'string') {
      const property = spec['property']
      const ascending = spec['isAscending'] === true
      records = [...records].sort((a, b) => {
        const av =
          property === 'size'
            ? a.size
            : property === 'subject'
              ? a.subject
              : property === 'from'
                ? (a.from[0]?.email ?? '')
                : a.receivedAt
        const bv =
          property === 'size'
            ? b.size
            : property === 'subject'
              ? b.subject
              : property === 'from'
                ? (b.from[0]?.email ?? '')
                : b.receivedAt
        if (av < bv) return ascending ? -1 : 1
        if (av > bv) return ascending ? 1 : -1
        return 0
      })
    }

    const position = typeof args['position'] === 'number' ? args['position'] : 0
    const limit = typeof args['limit'] === 'number' ? args['limit'] : records.length
    const page = records.slice(position, position + limit)
    const result: Record<string, unknown> = {
      accountId: this.accountId,
      queryState: `qs${this.emailState}`,
      canCalculateChanges: true,
      position,
      ids: page.map((record) => record.id),
    }
    if (args['calculateTotal'] !== false) result['total'] = records.length
    return result
  }

  private applyPatch(record: FixtureEmail, patch: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(patch)) {
      if (key.startsWith('mailboxIds/')) {
        const mailboxId = key.slice('mailboxIds/'.length)
        if (value === true) record.mailboxIds.add(mailboxId)
        else record.mailboxIds.delete(mailboxId)
      } else if (key.startsWith('keywords/')) {
        const keyword = key.slice('keywords/'.length)
        if (value === true) record.keywords.add(keyword)
        else record.keywords.delete(keyword)
      }
    }
  }

  private emailSet(call: MethodCall): unknown[] {
    const args = call.args
    const ifInState = args['ifInState']
    if (typeof ifInState === 'string' && ifInState !== `es${this.emailState}`) {
      return ['error', { type: 'stateMismatch' }, call.callId]
    }
    const created: Record<string, unknown> = {}
    const updated: Record<string, unknown> = {}
    const destroyed: string[] = []
    const notUpdated: Record<string, unknown> = {}
    const notDestroyed: Record<string, unknown> = {}
    const notCreated: Record<string, unknown> = {}

    const oldState = `es${this.emailState}`

    const createMap = args['create']
    if (createMap && typeof createMap === 'object') {
      for (const [creationId, value] of Object.entries(createMap as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') {
          notCreated[creationId] = { type: 'invalidArguments' }
          continue
        }
        const create = value as Record<string, unknown>
        const mailboxIds =
          create['mailboxIds'] && typeof create['mailboxIds'] === 'object'
            ? Object.keys(create['mailboxIds'] as Record<string, unknown>)
            : []
        if (mailboxIds.length === 0) {
          notCreated[creationId] = { type: 'invalidProperties', description: 'mailboxIds required' }
          continue
        }
        const id = this.nextId('e')
        const bodyValues =
          create['bodyValues'] && typeof create['bodyValues'] === 'object'
            ? (create['bodyValues'] as Record<string, { value?: unknown }>)
            : {}
        const textValue =
          typeof bodyValues['text']?.value === 'string' ? (bodyValues['text']?.value as string) : ''
        const htmlValue =
          typeof bodyValues['html']?.value === 'string'
            ? (bodyValues['html']?.value as string)
            : null
        const record: FixtureEmail = {
          id,
          threadId: this.nextId('t'),
          blobId: `blob-${id}`,
          mailboxIds: new Set(mailboxIds),
          keywords: new Set(
            create['keywords'] && typeof create['keywords'] === 'object'
              ? Object.keys(create['keywords'] as Record<string, unknown>)
              : [],
          ),
          size: textValue.length + (htmlValue?.length ?? 0),
          receivedAt: new Date().toISOString(),
          sentAt: new Date().toISOString(),
          from: (create['from'] as FixtureEmail['from']) ?? [],
          to: (create['to'] as FixtureEmail['to']) ?? [],
          cc: (create['cc'] as FixtureEmail['cc']) ?? [],
          bcc: (create['bcc'] as FixtureEmail['bcc']) ?? [],
          replyTo: (create['replyTo'] as FixtureEmail['replyTo']) ?? [],
          subject: typeof create['subject'] === 'string' ? (create['subject'] as string) : '',
          preview: textValue.slice(0, 120),
          messageId: [`<${id}@example.invalid>`],
          hasAttachment: Array.isArray(create['attachments']) && create['attachments'].length > 0,
          bodyText: textValue || null,
          bodyHtml: htmlValue,
        }
        this.emails.push(record)
        this.emailState += 1
        created[creationId] = this.serializeEmail(record)
      }
    }

    const updateMap = args['update']
    if (updateMap && typeof updateMap === 'object') {
      for (const [id, patch] of Object.entries(updateMap as Record<string, unknown>)) {
        const record = this.emails.find((entry) => entry.id === id)
        if (!record) {
          notUpdated[id] = { type: 'notFound' }
          continue
        }
        if (patch && typeof patch === 'object')
          this.applyPatch(record, patch as Record<string, unknown>)
        updated[id] = null
      }
      if (Object.keys(updated).length > 0) this.emailState += 1
    }

    const destroyList = args['destroy']
    if (Array.isArray(destroyList)) {
      for (const id of destroyList) {
        const index = this.emails.findIndex((entry) => entry.id === id)
        if (index < 0) {
          notDestroyed[String(id)] = { type: 'notFound' }
          continue
        }
        this.emails.splice(index, 1)
        destroyed.push(String(id))
      }
      if (destroyed.length > 0) this.emailState += 1
    }

    return [
      'Email/set',
      {
        accountId: this.accountId,
        oldState,
        newState: `es${this.emailState}`,
        created: Object.keys(created).length > 0 ? created : null,
        updated: Object.keys(updated).length > 0 ? updated : null,
        destroyed: destroyed.length > 0 ? destroyed : null,
        notCreated: Object.keys(notCreated).length > 0 ? notCreated : null,
        notUpdated: Object.keys(notUpdated).length > 0 ? notUpdated : null,
        notDestroyed: Object.keys(notDestroyed).length > 0 ? notDestroyed : null,
      },
      call.callId,
    ]
  }

  private emailChanges(args: Record<string, unknown>): Record<string, unknown> {
    const sinceState = typeof args['sinceState'] === 'string' ? (args['sinceState'] as string) : ''
    const current = `es${this.emailState}`
    if (sinceState === current) {
      return {
        accountId: this.accountId,
        oldState: sinceState,
        newState: current,
        hasMoreChanges: false,
        created: [],
        updated: [],
        destroyed: [],
      }
    }
    return {
      accountId: this.accountId,
      oldState: sinceState,
      newState: current,
      hasMoreChanges: false,
      created: [],
      updated: this.emails.map((entry) => entry.id),
      destroyed: [],
    }
  }

  private threadGet(args: Record<string, unknown>): Record<string, unknown> {
    const ids = args['ids']
    const threads = new Map<string, string[]>()
    for (const record of this.emails) {
      const list = threads.get(record.threadId) ?? []
      list.push(record.id)
      threads.set(record.threadId, list)
    }
    const wanted = Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string')
      : [...threads.keys()]
    const list = wanted
      .filter((id) => threads.has(id))
      .map((id) => ({ id, emailIds: threads.get(id) ?? [] }))
    const notFound =
      ids === null || ids === undefined ? [] : wanted.filter((id) => !threads.has(id))
    return { accountId: this.accountId, state: `ts${this.emailState}`, list, notFound }
  }

  private identityGet(args: Record<string, unknown>): Record<string, unknown> {
    const ids = args['ids']
    const list =
      ids === null || ids === undefined
        ? this.identities
        : this.identities.filter((identity) => Array.isArray(ids) && ids.includes(identity.id))
    return {
      accountId: this.accountId,
      state: 'ids1',
      list: list.map((identity) => ({
        id: identity.id,
        name: identity.name,
        email: identity.email,
        replyTo: null,
        bcc: null,
        textSignature: '',
        htmlSignature: '',
        mayDelete: false,
      })),
      notFound: [],
    }
  }

  private submissionGet(args: Record<string, unknown>): Record<string, unknown> {
    const ids = args['ids']
    const list = [...this.submissions.values()]
      .filter(
        (submission) =>
          ids === null || ids === undefined || (Array.isArray(ids) && ids.includes(submission.id)),
      )
      .map((submission) => ({
        id: submission.id,
        identityId: submission.identityId,
        emailId: submission.emailId,
        threadId: this.emails.find((email) => email.id === submission.emailId)?.threadId ?? null,
        undoStatus: submission.undoStatus,
        sendAt: submission.sendAt,
        undoWindowExpiresAt: submission.undoWindowExpiresAt,
      }))
    return { accountId: this.accountId, state: `sub${this.submissionState}`, list, notFound: [] }
  }

  private submissionSet(call: MethodCall): unknown[] {
    const args = call.args
    if (typeof args['ifInState'] === 'string' && args['ifInState'] !== `sub${this.submissionState}`)
      return ['error', { type: 'stateMismatch' }, call.callId]
    const created: Record<string, unknown> = {}
    const updated: Record<string, unknown> = {}
    const notCreated: Record<string, unknown> = {}
    const notUpdated: Record<string, unknown> = {}

    const createMap = args['create']
    if (createMap && typeof createMap === 'object') {
      for (const [creationId, value] of Object.entries(createMap as Record<string, unknown>)) {
        const create = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
        const identityId =
          typeof create['identityId'] === 'string' ? create['identityId'] : undefined
        const emailId = typeof create['emailId'] === 'string' ? create['emailId'] : undefined
        if (!identityId || !this.identities.some((identity) => identity.id === identityId)) {
          notCreated[creationId] = { type: 'invalidProperties', description: 'unknown identityId' }
          continue
        }
        if (!emailId || !this.emails.some((record) => record.id === emailId)) {
          notCreated[creationId] = { type: 'invalidProperties', description: 'unknown emailId' }
          continue
        }
        const undoDelaySeconds =
          typeof create['undoDelaySeconds'] === 'number'
            ? (create['undoDelaySeconds'] as number)
            : 0
        const sendAt = typeof create['sendAt'] === 'string' ? (create['sendAt'] as string) : null
        const held = undoDelaySeconds > 0 || sendAt !== null
        const id = this.nextId('s')
        const submission: FixtureSubmission = {
          id,
          identityId,
          emailId,
          undoStatus: held ? 'pending' : 'final',
          undoWindowExpiresAt: held
            ? new Date(Date.now() + Math.max(undoDelaySeconds, 1) * 1000).toISOString()
            : null,
          sendAt,
        }
        this.submissions.set(id, submission)
        this.submissionState += 1
        if (!held) this.completeSend(emailId)
        created[creationId] = {
          id,
          identityId,
          emailId,
          threadId: this.emails.find((r) => r.id === emailId)?.threadId ?? null,
          undoStatus: submission.undoStatus,
          sendAt,
          undoWindowExpiresAt: submission.undoWindowExpiresAt,
        }
      }
    }

    const updateMap = args['update']
    if (updateMap && typeof updateMap === 'object') {
      for (const [id, patch] of Object.entries(updateMap as Record<string, unknown>)) {
        const submission = this.submissions.get(id)
        if (!submission) {
          notUpdated[id] = { type: 'notFound' }
          continue
        }
        if (
          patch &&
          typeof patch === 'object' &&
          (patch as Record<string, unknown>)['undoStatus'] === 'canceled'
        ) {
          submission.undoStatus = 'canceled'
          this.submissionState += 1
        }
        updated[id] = null
      }
    }

    return [
      'EmailSubmission/set',
      {
        accountId: this.accountId,
        oldState: `sub${this.submissionState - (Object.keys(created).length > 0 || Object.keys(updated).length > 0 ? 1 : 0)}`,
        newState: `sub${this.submissionState}`,
        created: Object.keys(created).length > 0 ? created : null,
        updated: Object.keys(updated).length > 0 ? updated : null,
        destroyed: null,
        notCreated: Object.keys(notCreated).length > 0 ? notCreated : null,
        notUpdated: Object.keys(notUpdated).length > 0 ? notUpdated : null,
        notDestroyed: null,
      },
      call.callId,
    ]
  }

  private completeSend(emailId: string): void {
    const record = this.emails.find((entry) => entry.id === emailId)
    if (!record) return
    record.keywords.delete('$draft')
    const sent = this.mailboxes.find((mailbox) => mailbox.role === 'sent')
    if (sent) {
      for (const mailboxId of [...record.mailboxIds]) record.mailboxIds.delete(mailboxId)
      record.mailboxIds.add(sent.id)
    }
  }
}

export async function startJmapFixture(options: FixtureOptions = {}): Promise<JmapFixture> {
  return new JmapFixture(options).start()
}
