import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls'
import type { ProtocolLimits } from '../common/limits.js'

export type TlsMode = 'none' | 'implicit' | 'starttls'

export interface ConnectionOptions {
  host: string
  port: number
  /** Transport security mode. Defaults to `none`. */
  tls?: TlsMode
  tlsOptions?: TlsConnectionOptions
  limits?: Partial<ProtocolLimits>
  /** Cancels connection establishment. */
  signal?: AbortSignal
  /** Overrides the connection-establishment timeout only. */
  connectTimeoutMs?: number
}
