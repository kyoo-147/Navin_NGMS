import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import type { StalwartAccount, StalwartAlias, StalwartDomain } from '../stalwart/wire.js'

export interface CapturedRequest {
  method: string
  path: string
  headers: Record<string, string | undefined>
  body: unknown
  idempotencyKey?: string
  receivedAt: string
}

export interface CapturedJmapCall {
  method: string
  args: Record<string, unknown>
  callId: string
  idempotencyKey?: string
}

export interface FixtureResponseOverride {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export interface StalwartFixtureOptions {
  product?: string
  version?: string
  build?: string
  token?: string
  username?: string
  password?: string
  ready?: boolean
  domains?: StalwartDomain[]
  accounts?: StalwartAccount[]
  aliases?: StalwartAlias[]
  latencyMs?: number
  requireIdempotencyKey?: boolean
}

const SET_METHOD_RE = /^x:([A-Za-z]+)\/(query|get|set)$/

export class StalwartFixtureServer {
  readonly requests: CapturedRequest[] = []
  readonly jmapCalls: CapturedJmapCall[] = []

  private readonly options: StalwartFixtureOptions
  private readonly domains: StalwartDomain[]
  private readonly accounts: StalwartAccount[]
  private readonly aliases: StalwartAlias[]
  private readonly idempotencyIndex = new Map<string, string>()
  private readonly overrides: FixtureResponseOverride[] = []
  private readonly methodFailures = new Map<string, { type: string; description: string }>()
  private counters = { domain: 0, account: 0, alias: 0 }
  private server: Server | undefined
  private boundPort = 0
  private latencyMs: number
  private ready: boolean
  private readonly basicEncoded: string | undefined

  constructor(options: StalwartFixtureOptions = {}) {
    this.options = options
    this.domains = [...(options.domains ?? [])]
    this.accounts = [...(options.accounts ?? [])]
    this.aliases = [...(options.aliases ?? [])]
    this.latencyMs = options.latencyMs ?? 0
    this.ready = options.ready ?? true
    if (options.username !== undefined && options.password !== undefined) {
      this.basicEncoded = Buffer.from(`${options.username}:${options.password}`, 'utf8').toString(
        'base64',
      )
    }
    this.counters = {
      domain: maxIdSuffix(this.domains, 'd'),
      account: maxIdSuffix(this.accounts, 'a'),
      alias: maxIdSuffix(this.aliases, 'al'),
    }
  }

  get port(): number {
    return this.boundPort
  }

  get url(): string {
    return `http://127.0.0.1:${this.boundPort}`
  }

  async start(): Promise<void> {
    if (this.server) return
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.writableEnded) {
          writeJson(res, 500, { type: 'serverFail', description: 'fixture handler crash' })
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('fixture server did not bind a TCP port')
    }
    this.boundPort = address.port
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = undefined
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  setLatency(ms: number): void {
    this.latencyMs = ms
  }

  setReady(ready: boolean): void {
    this.ready = ready
  }

  enqueueResponse(override: FixtureResponseOverride): void {
    this.overrides.push(override)
  }

  failNextMethod(method: string, failure: { type: string; description: string }): void {
    this.methodFailures.set(method, failure)
  }

  getDomains(): StalwartDomain[] {
    return this.domains.map((domain) => ({ ...domain }))
  }

  getAccounts(): StalwartAccount[] {
    return this.accounts.map((account) => ({ ...account }))
  }

  getAliases(): StalwartAlias[] {
    return this.aliases.map((alias) => ({ ...alias }))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req)
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const idempotencyKey = headerValue(req, 'idempotency-key')
    const captured: CapturedRequest = {
      method: req.method ?? 'GET',
      path: url.pathname,
      headers: req.headers as Record<string, string | undefined>,
      body,
      receivedAt: new Date().toISOString(),
    }
    if (idempotencyKey !== undefined) captured.idempotencyKey = idempotencyKey
    this.requests.push(captured)

    if (this.latencyMs > 0) await delay(this.latencyMs)

    const override = this.overrides.shift()
    if (override) {
      for (const [key, value] of Object.entries(override.headers ?? {})) res.setHeader(key, value)
      writeJson(res, override.status, override.body)
      return
    }

    if (url.pathname === '/healthz/ready') {
      if (this.ready) writeJson(res, 200, { status: 'ready' })
      else writeJson(res, 503, { status: 'initializing' })
      return
    }
    if (url.pathname === '/healthz/live') {
      writeJson(res, 200, { status: 'live' })
      return
    }

    if (!this.checkAuth(req)) {
      writeJson(res, 401, { type: 'unauthorized', description: 'Invalid credentials' })
      return
    }

    if (url.pathname === this.apiVersionPath() && req.method === 'GET') {
      writeJson(res, 200, {
        product: this.options.product ?? 'Stalwart Mail Server',
        version: this.options.version ?? '0.16.24',
        build: this.options.build ?? 'fixture',
      })
      return
    }

    if (url.pathname === '/api' && req.method === 'POST') {
      this.handleJmap(body, idempotencyKey, res)
      return
    }

    writeJson(res, 404, { type: 'notFound', description: `No route for ${url.pathname}` })
  }

  private apiVersionPath(): string {
    return '/api/version'
  }

  private handleJmap(body: unknown, idempotencyKey: string | undefined, res: ServerResponse): void {
    const record =
      body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const methodCalls = Array.isArray(record.methodCalls) ? record.methodCalls : []
    const call = methodCalls[0]
    if (!Array.isArray(call) || call.length < 3) {
      writeJson(res, 400, { type: 'invalidArguments', description: 'Missing method call' })
      return
    }
    const method = String(call[0])
    const args =
      call[1] !== null && typeof call[1] === 'object' ? (call[1] as Record<string, unknown>) : {}
    const callId = String(call[2])
    const capturedCall: CapturedJmapCall = { method, args, callId }
    if (idempotencyKey !== undefined) capturedCall.idempotencyKey = idempotencyKey
    this.jmapCalls.push(capturedCall)

    const failure = this.methodFailures.get(method)
    if (failure) {
      this.methodFailures.delete(method)
      writeJson(res, 200, {
        methodResponses: [['error', failure, callId]],
        sessionState: 's1',
      })
      return
    }

    const match = SET_METHOD_RE.exec(method)
    if (!match) {
      writeJson(res, 200, {
        methodResponses: [['error', { type: 'unknownMethod', description: method }, callId]],
        sessionState: 's1',
      })
      return
    }

    const objectType = match[1] ?? ''
    const operation = match[2]
    if (!['Domain', 'Account', 'Alias'].includes(objectType)) {
      writeJson(res, 200, {
        methodResponses: [['error', { type: 'unknownMethod', description: method }, callId]],
        sessionState: 's1',
      })
      return
    }

    let result: Record<string, unknown>
    if (operation === 'query') result = this.handleQuery(objectType, args)
    else if (operation === 'get') result = this.handleGet(objectType, args)
    else result = this.handleSet(objectType, args, idempotencyKey)

    writeJson(res, 200, {
      methodResponses: [[method, result, callId]],
      sessionState: 's1',
    })
  }

  private listFor(objectType: string): Array<Record<string, unknown>> {
    if (objectType === 'Domain') return this.domains as unknown as Array<Record<string, unknown>>
    if (objectType === 'Account') return this.accounts as unknown as Array<Record<string, unknown>>
    return this.aliases as unknown as Array<Record<string, unknown>>
  }

  private handleQuery(objectType: string, args: Record<string, unknown>): Record<string, unknown> {
    const filter =
      args.filter !== null && typeof args.filter === 'object'
        ? (args.filter as Record<string, unknown>)
        : {}
    const ids = this.listFor(objectType)
      .filter((item) => matchesFilter(item, filter))
      .map((item) => String(item.id))
    return { ids, total: ids.length }
  }

  private handleGet(objectType: string, args: Record<string, unknown>): Record<string, unknown> {
    const ids = Array.isArray(args.ids) ? args.ids.map((id) => String(id)) : []
    const list = this.listFor(objectType).filter((item) => ids.includes(String(item.id)))
    return { list, notFound: ids.filter((id) => !list.some((item) => String(item.id) === id)) }
  }

  private handleSet(
    objectType: string,
    args: Record<string, unknown>,
    idempotencyKey: string | undefined,
  ): Record<string, unknown> {
    const list = this.listFor(objectType)
    const created: Record<string, { id: string }> = {}
    const updated: Record<string, unknown> = {}
    const destroyed: string[] = []
    const notCreated: Record<string, { type: string; description: string }> = {}
    const notUpdated: Record<string, { type: string; description: string }> = {}
    const notDestroyed: Record<string, { type: string; description: string }> = {}

    if (args.create !== null && typeof args.create === 'object') {
      if (this.options.requireIdempotencyKey === true && idempotencyKey === undefined) {
        return {
          notCreated: {
            '*': { type: 'invalidArguments', description: 'Idempotency-Key required' },
          },
        }
      }
      for (const [creationId, value] of Object.entries(args.create as Record<string, unknown>)) {
        const record =
          value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
        const indexKey = `${objectType}:${idempotencyKey ?? ''}`
        const existingId =
          idempotencyKey === undefined ? undefined : this.idempotencyIndex.get(indexKey)
        if (existingId !== undefined) {
          created[creationId] = { id: existingId }
          continue
        }
        const id = this.nextId(objectType)
        const stored = { id, ...record }
        list.push(stored)
        created[creationId] = { id }
        if (idempotencyKey !== undefined) this.idempotencyIndex.set(indexKey, id)
      }
    }

    if (args.update !== null && typeof args.update === 'object') {
      for (const [id, patch] of Object.entries(args.update as Record<string, unknown>)) {
        const item = list.find((entry) => String(entry.id) === id)
        if (!item) {
          notUpdated[id] = { type: 'notFound', description: `No ${objectType} with id ${id}` }
          continue
        }
        Object.assign(item, patch !== null && typeof patch === 'object' ? patch : {})
        updated[id] = null
      }
    }

    if (Array.isArray(args.destroy)) {
      for (const rawId of args.destroy) {
        const id = String(rawId)
        const index = list.findIndex((entry) => String(entry.id) === id)
        if (index < 0) {
          notDestroyed[id] = { type: 'notFound', description: `No ${objectType} with id ${id}` }
          continue
        }
        list.splice(index, 1)
        destroyed.push(id)
      }
    }

    const result: Record<string, unknown> = {}
    if (Object.keys(created).length > 0) result.created = created
    if (Object.keys(updated).length > 0) result.updated = updated
    if (destroyed.length > 0) result.destroyed = destroyed
    if (Object.keys(notCreated).length > 0) result.notCreated = notCreated
    if (Object.keys(notUpdated).length > 0) result.notUpdated = notUpdated
    if (Object.keys(notDestroyed).length > 0) result.notDestroyed = notDestroyed
    return result
  }

  private nextId(objectType: string): string {
    if (objectType === 'Domain') {
      this.counters.domain += 1
      return `d${this.counters.domain}`
    }
    if (objectType === 'Account') {
      this.counters.account += 1
      return `a${this.counters.account}`
    }
    this.counters.alias += 1
    return `al${this.counters.alias}`
  }

  private checkAuth(req: IncomingMessage): boolean {
    if (this.options.token === undefined && this.basicEncoded === undefined) return true
    const header = headerValue(req, 'authorization')
    if (header === undefined) return false
    if (this.options.token !== undefined) return header === `Bearer ${this.options.token}`
    return header === `Basic ${this.basicEncoded}`
  }
}

function matchesFilter(item: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue
    if (item[key] !== value) return false
  }
  return true
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0]
  return value
}

function maxIdSuffix(items: Array<{ id: string }>, prefix: string): number {
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  let max = 0
  for (const item of items) {
    const match = pattern.exec(item.id)
    if (match?.[1]) max = Math.max(max, Number(match[1]))
  }
  return max
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  }
  if (chunks.length === 0) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.statusCode = status
  if (payload.length > 0 && !res.getHeader('content-type')) {
    res.setHeader('content-type', 'application/json')
  }
  res.end(payload)
}
