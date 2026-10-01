import { ProtocolError } from './errors.js'

/** Bounded resource policy applied to every protocol connection. */
export interface ProtocolLimits {
  /** Wall-clock budget for establishing the TCP/TLS connection. */
  connectTimeoutMs: number
  /** Wall-clock budget for a single command/response round trip. */
  commandTimeoutMs: number
  /** Maximum bytes tolerated in a single protocol line before a CRLF. */
  maxLineBytes: number
  /** Maximum bytes tolerated while draining one response (all untagged + tagged). */
  maxResponseBytes: number
  /** Maximum bytes accepted for a single IMAP literal payload. */
  maxLiteralBytes: number
  /** Maximum lines accepted in one SMTP reply. */
  maxResponseLines: number
  /** Maximum bytes allowed in one outgoing message/DATA payload. */
  maxMessageBytes: number
}

export const DEFAULT_PROTOCOL_LIMITS: ProtocolLimits = {
  connectTimeoutMs: 10_000,
  commandTimeoutMs: 30_000,
  maxLineBytes: 64 * 1024,
  maxResponseBytes: 25 * 1024 * 1024,
  maxLiteralBytes: 25 * 1024 * 1024,
  maxResponseLines: 1_024,
  maxMessageBytes: 25 * 1024 * 1024,
}

export function resolveLimits(overrides: Partial<ProtocolLimits> = {}): ProtocolLimits {
  const merged: ProtocolLimits = { ...DEFAULT_PROTOCOL_LIMITS, ...overrides }
  for (const key of Object.keys(merged) as (keyof ProtocolLimits)[]) {
    const value = merged[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new ProtocolError('LIMIT_EXCEEDED', `Invalid protocol limit: ${key}`, {
        details: { limit: key, value },
      })
    }
  }
  return merged
}
