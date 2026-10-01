import { EngineError } from '../errors.js'
import type { EngineResourceKind } from '../resources.js'
import type { HttpTransport, TransportCallOptions } from '../transport.js'
import { jmapError } from './mapper.js'
import { DEFAULT_STALWART_PROFILE, type StalwartProtocolProfile } from './profile.js'
import type {
  JmapErrorSource,
  JmapMethodCall,
  JmapResponse,
  JmapSetResponseArgs,
  StalwartAccount,
  StalwartAlias,
  StalwartDomain,
} from './wire.js'

export interface StalwartAdminClientOptions {
  transport: HttpTransport
  profile?: StalwartProtocolProfile
  accountId?: string
}

export type QueryFilter = Record<string, unknown>

export class StalwartAdminClient {
  readonly profile: StalwartProtocolProfile
  private readonly transport: HttpTransport
  private readonly accountId: string | undefined
  private callCounter = 0

  constructor(options: StalwartAdminClientOptions) {
    this.transport = options.transport
    this.profile = options.profile ?? DEFAULT_STALWART_PROFILE
    this.accountId = options.accountId
  }

  private nextCallId(): string {
    this.callCounter += 1
    return `c${this.callCounter}`
  }

  async call<T = Record<string, unknown>>(
    method: string,
    args: Record<string, unknown> = {},
    options: TransportCallOptions = {},
  ): Promise<T> {
    const callId = this.nextCallId()
    const callArgs =
      this.accountId !== undefined && args.accountId === undefined
        ? { ...args, accountId: this.accountId }
        : args
    const methodCall: JmapMethodCall = [method, callArgs, callId]
    const response = await this.transport.request<JmapResponse>(
      {
        method: 'POST',
        path: this.profile.apiPath,
        body: { using: this.profile.capabilities, methodCalls: [methodCall] },
      },
      options,
    )
    const data = response.data
    if (!data || !Array.isArray(data.methodResponses) || data.methodResponses.length === 0) {
      throw new EngineError({
        category: 'protocol',
        message: 'Engine returned an empty JMAP response',
        requestId: response.requestId,
      })
    }
    const first = data.methodResponses[0]
    if (!first || !Array.isArray(first) || first.length < 3) {
      throw new EngineError({
        category: 'protocol',
        message: 'Engine returned a malformed JMAP method response',
        requestId: response.requestId,
      })
    }
    const [methodName, responseArgs] = first
    if (methodName === 'error') {
      throw jmapError(responseArgs as JmapErrorSource, 'Engine admin call failed')
    }
    return responseArgs as T
  }

  async findDomains(
    filter: QueryFilter,
    options: TransportCallOptions = {},
  ): Promise<StalwartDomain[]> {
    return this.queryList<StalwartDomain>(
      this.profile.methods.domainQuery,
      this.profile.methods.domainGet,
      filter,
      options,
    )
  }

  async findAccounts(
    filter: QueryFilter,
    options: TransportCallOptions = {},
  ): Promise<StalwartAccount[]> {
    return this.queryList<StalwartAccount>(
      this.profile.methods.accountQuery,
      this.profile.methods.accountGet,
      filter,
      options,
    )
  }

  async findAliases(
    filter: QueryFilter,
    options: TransportCallOptions = {},
  ): Promise<StalwartAlias[]> {
    return this.queryList<StalwartAlias>(
      this.profile.methods.aliasQuery,
      this.profile.methods.aliasGet,
      filter,
      options,
    )
  }

  async createObject(
    kind: EngineResourceKind,
    value: Record<string, unknown>,
    options: TransportCallOptions = {},
  ): Promise<string> {
    const creationId = `new-${kind}`
    const args = await this.call<JmapSetResponseArgs>(
      this.setMethod(kind),
      { create: { [creationId]: value } },
      options,
    )
    const created = args.created?.[creationId]
    if (created?.id) return created.id
    const failure = args.notCreated?.[creationId]
    if (failure) throw jmapError(failure, `Failed to create ${kind}`)
    throw new EngineError({
      category: 'protocol',
      message: `Engine did not confirm creation of ${kind}`,
    })
  }

  async updateObject(
    kind: EngineResourceKind,
    id: string,
    value: Record<string, unknown>,
    options: TransportCallOptions = {},
  ): Promise<void> {
    const args = await this.call<JmapSetResponseArgs>(
      this.setMethod(kind),
      { update: { [id]: value } },
      options,
    )
    const failure = args.notUpdated?.[id]
    if (failure) throw jmapError(failure, `Failed to update ${kind}`)
  }

  async destroyObject(
    kind: EngineResourceKind,
    id: string,
    options: TransportCallOptions = {},
  ): Promise<boolean> {
    const args = await this.call<JmapSetResponseArgs>(
      this.setMethod(kind),
      { destroy: [id] },
      options,
    )
    const failure = args.notDestroyed?.[id]
    if (failure) {
      const error = jmapError(failure, `Failed to delete ${kind}`)
      if (error.category === 'not_found') return false
      throw error
    }
    return true
  }

  private setMethod(kind: EngineResourceKind): string {
    if (kind === 'domain') return this.profile.methods.domainSet
    if (kind === 'mailbox') return this.profile.methods.accountSet
    return this.profile.methods.aliasSet
  }

  private async queryList<T>(
    queryMethod: string,
    getMethod: string,
    filter: QueryFilter,
    options: TransportCallOptions,
  ): Promise<T[]> {
    const queryArgs = await this.call<{ ids?: unknown }>(
      queryMethod,
      { filter, limit: 1000 },
      options,
    )
    const ids = Array.isArray(queryArgs.ids)
      ? queryArgs.ids.filter((value): value is string => typeof value === 'string')
      : []
    if (ids.length === 0) return []
    const getArgs = await this.call<{ list?: unknown }>(getMethod, { ids }, options)
    const list = Array.isArray(getArgs.list) ? getArgs.list : []
    return list.filter((value): value is T => typeof value === 'object' && value !== null)
  }
}
