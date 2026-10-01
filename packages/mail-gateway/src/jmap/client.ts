import { GatewayError, gatewayErrorFromJmapMethod } from '../errors.js'
import type { UpstreamJmapCredential } from '../credentials/provider.js'
import {
  JMAP_CORE,
  JMAP_MAIL,
  JMAP_SUBMISSION,
  readGatewayCapabilities,
  type GatewayCapabilities,
} from './capabilities.js'
import { JmapHttpTransport, type JmapTransport } from './transport.js'
import { validateAndResolveJmapSession, validateJmapUrl } from './url-policy.js'
import {
  isRecord,
  type JmapAccount,
  type JmapMethodResult,
  type JmapResponse,
  type JmapSession,
} from './types.js'

export interface JmapCallSpec {
  name: string
  args: Record<string, unknown>
  callId?: string
}

export interface JmapInvokeOptions {
  using?: string[]
  signal?: AbortSignal
  timeoutMs?: number
}

export interface JmapClientOptions {
  credential: UpstreamJmapCredential
  transport?: JmapTransport
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

function parseSession(payload: unknown, sessionUrl: string): JmapSession {
  if (
    !isRecord(payload) ||
    typeof payload.apiUrl !== 'string' ||
    typeof payload.state !== 'string' ||
    !isRecord(payload.accounts) ||
    !isRecord(payload.capabilities) ||
    !isRecord(payload.primaryAccounts)
  ) {
    throw new GatewayError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Upstream JMAP session document is malformed',
      details: { reason: 'invalid-session' },
    })
  }
  const accounts: Record<string, JmapAccount> = {}
  for (const [id, account] of Object.entries(payload.accounts)) {
    if (!isRecord(account)) continue
    accounts[id] = {
      name: typeof account.name === 'string' ? account.name : id,
      isPersonal: account.isPersonal === true,
      isReadOnly: account.isReadOnly === true,
      accountCapabilities: isRecord(account.accountCapabilities) ? account.accountCapabilities : {},
    }
  }
  const urls = validateAndResolveJmapSession(sessionUrl, payload)
  return {
    capabilities: payload.capabilities,
    accounts,
    primaryAccounts: Object.fromEntries(
      Object.entries(payload.primaryAccounts).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    username: typeof payload.username === 'string' ? payload.username : '',
    apiUrl: urls.apiUrl,
    downloadUrl: urls.downloadUrl,
    uploadUrl: urls.uploadUrl,
    eventSourceUrl: urls.eventSourceUrl,
    state: payload.state,
  }
}

/**
 * A connected, capability-negotiated JMAP client bound to a single upstream
 * account session. Construct via {@link JmapClient.connect}.
 */
export class JmapClient {
  readonly session: JmapSession
  readonly capabilities: GatewayCapabilities
  private readonly transport: JmapTransport
  private readonly credential: UpstreamJmapCredential
  private readonly timeoutMs: number
  private callSeq = 0
  private sessionState: string

  private constructor(
    transport: JmapTransport,
    credential: UpstreamJmapCredential,
    session: JmapSession,
    timeoutMs: number,
  ) {
    this.transport = transport
    this.credential = credential
    this.session = session
    this.sessionState = session.state
    this.timeoutMs = timeoutMs
    this.capabilities = readGatewayCapabilities(session)
  }

  static async connect(options: JmapClientOptions): Promise<JmapClient> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const sessionUrl = validateJmapUrl(options.credential.sessionUrl, 'session').toString()
    if (!options.credential.authorization || /[\r\n]/.test(options.credential.authorization)) {
      throw new GatewayError({
        code: 'VALIDATION_FAILED',
        message: 'Upstream authorization header is invalid',
        details: { reason: 'invalid-authorization' },
      })
    }
    const transport = options.transport ?? new JmapHttpTransport({ timeoutMs })
    const response = await transport.send({
      url: sessionUrl,
      method: 'GET',
      headers: { authorization: options.credential.authorization },
      timeoutMs,
      allowedOrigin: new URL(sessionUrl).origin,
    })
    const session = parseSession(response.json, sessionUrl)
    return new JmapClient(transport, options.credential, session, timeoutMs)
  }

  get currentSessionState(): string {
    return this.sessionState
  }

  supports(uri: string): boolean {
    return this.capabilities.uris.has(uri)
  }

  account(upstreamAccountId: string): JmapAccount {
    const account = this.session.accounts[upstreamAccountId]
    if (!account) {
      throw new GatewayError({
        code: 'NOT_FOUND',
        message: `Upstream account ${upstreamAccountId} is not present in the session`,
        details: { upstreamAccountId },
      })
    }
    return account
  }

  capabilitiesForAccount(upstreamAccountId: string): GatewayCapabilities {
    return readGatewayCapabilities(this.session, upstreamAccountId)
  }

  primaryAccountId(uri: string): string | undefined {
    return this.session.primaryAccounts[uri]
  }

  /**
   * Capability set to declare on an API request. Core and Mail are always
   * declared (a mail gateway cannot function without them); Submission is
   * declared only when advertised. Unknown extras are dropped rather than
   * causing the whole request to fail.
   */
  private usingSet(extra: string[] = []): string[] {
    const using = new Set<string>([JMAP_CORE, JMAP_MAIL])
    if (this.capabilities.submission) using.add(JMAP_SUBMISSION)
    for (const uri of extra) {
      if (this.capabilities.uris.has(uri)) using.add(uri)
    }
    return [...using]
  }

  async invoke(
    calls: JmapCallSpec[],
    options: JmapInvokeOptions = {},
  ): Promise<JmapMethodResult[]> {
    if (calls.length === 0) return []
    const maxCalls = this.capabilities.core?.maxCallsInRequest ?? 0
    if (maxCalls > 0 && calls.length > maxCalls) {
      throw new GatewayError({
        code: 'VALIDATION_FAILED',
        message: `Request contains ${calls.length} method calls, exceeding upstream limit ${maxCalls}`,
        details: { maxCallsInRequest: maxCalls },
      })
    }

    const expected = new Map<string, string>()
    const methodCalls = calls.map((call) => {
      const callId = call.callId ?? `c${++this.callSeq}`
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(callId) || expected.has(callId)) {
        throw new GatewayError({
          code: 'VALIDATION_FAILED',
          message: 'JMAP callId is malformed or duplicated',
          details: { callId },
        })
      }
      expected.set(callId, call.name)
      return [call.name, call.args, callId]
    })

    const response = await this.transport.send({
      url: this.session.apiUrl,
      method: 'POST',
      headers: { authorization: this.credential.authorization },
      body: { using: this.usingSet(options.using), methodCalls },
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      allowedOrigin: new URL(this.session.apiUrl).origin,
    })

    const data = response.json
    if (!isRecord(data) || !Array.isArray(data.methodResponses)) {
      throw new GatewayError({
        code: 'INTERNAL_ERROR',
        message: 'Upstream JMAP response is malformed',
        details: { reason: 'invalid-response' },
      })
    }

    if (typeof data.sessionState === 'string') this.sessionState = data.sessionState

    const results: JmapMethodResult[] = []
    const seenCallIds = new Set<string>()
    for (const entry of data.methodResponses as unknown[]) {
      if (!Array.isArray(entry) || entry.length !== 3) {
        throw new GatewayError({
          code: 'INTERNAL_ERROR',
          message: 'Upstream JMAP response contains a malformed method response',
        })
      }
      const [name, args, callId] = entry as [unknown, unknown, unknown]
      if (typeof name !== 'string' || typeof callId !== 'string' || !isRecord(args)) {
        throw new GatewayError({
          code: 'INTERNAL_ERROR',
          message: 'Upstream JMAP response contains a malformed method response',
        })
      }
      const expectedName = expected.get(callId)
      if (!expectedName || seenCallIds.has(callId) || (name !== 'error' && name !== expectedName)) {
        throw new GatewayError({
          code: 'INTERNAL_ERROR',
          message: 'Upstream JMAP response callId correlation failed',
          details: { callId },
        })
      }
      seenCallIds.add(callId)
      if (name === 'error') {
        const type = typeof args.type === 'string' ? args.type : 'serverFail'
        const description = typeof args.description === 'string' ? args.description : undefined
        throw gatewayErrorFromJmapMethod({ type, description }, { callId })
      }
      results.push({ name, args, callId })
    }
    if (seenCallIds.size !== expected.size) {
      throw new GatewayError({
        code: 'INTERNAL_ERROR',
        message: 'Upstream JMAP response omitted a requested callId',
        details: { expected: expected.size, received: seenCallIds.size },
      })
    }
    return results
  }

  async invokeOne<A = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown>,
    options: JmapInvokeOptions = {},
  ): Promise<A> {
    const results = await this.invoke([{ name, args }], options)
    const first = results[0]
    if (!first) {
      throw new GatewayError({
        code: 'INTERNAL_ERROR',
        message: `JMAP method ${name} returned no response`,
      })
    }
    return first.args as A
  }
}

export type { JmapResponse }
