export interface StalwartDomain {
  id: string
  name: string
  description?: string
  dkimSigning?: boolean
  catchAll?: string | null
}

export interface StalwartAccount {
  id: string
  name: string
  domainId: string
  description?: string
  quotaBytes?: number
}

export interface StalwartAlias {
  id: string
  name: string
  domainId: string
  target: string
  enabled?: boolean
  description?: string
}

export interface StalwartVersionInfo {
  product?: string
  version?: string
  build?: string
}

export type JmapMethodCall = [name: string, args: Record<string, unknown>, callId: string]

export interface JmapRequest {
  using: string[]
  methodCalls: JmapMethodCall[]
}

export type JmapMethodResponse = [name: string, args: Record<string, unknown>, callId: string]

export interface JmapResponse {
  methodResponses: JmapMethodResponse[]
  sessionState?: string
}

export interface JmapSetFailure {
  type?: string
  description?: string
}

export interface JmapSetResponseArgs {
  created?: Record<string, { id: string }>
  updated?: Record<string, unknown>
  destroyed?: string[]
  notCreated?: Record<string, JmapSetFailure>
  notUpdated?: Record<string, JmapSetFailure>
  notDestroyed?: Record<string, JmapSetFailure>
}

export interface JmapErrorSource {
  type?: string
  description?: string
  status?: number
}
