import { GatewayError } from '../errors.js'

/**
 * Reversible codec between opaque upstream JMAP identifiers and the branded,
 * pattern-constrained identifiers required by the Navin contracts
 * (`acc_`, `mbx_`, `thd_`, `msg_`, `als_` ...).
 *
 * Upstream identifiers are base64url-encoded so the mapping is deterministic,
 * stateless and collision-free, and fits the
 * `^<prefix>_[a-zA-Z0-9._-]+$` contract pattern.
 */
export const ID_PREFIXES = [
  'acc',
  'usr',
  'dom',
  'mbx',
  'fld',
  'als',
  'grp',
  'thd',
  'msg',
  'dft',
  'sub',
  'prv',
  'ext',
] as const

export type IdPrefix = (typeof ID_PREFIXES)[number]

const PREFIX_SET: ReadonlySet<string> = new Set(ID_PREFIXES)
const MAX_ID_LENGTH = 128

export function encodeId(prefix: IdPrefix, upstreamId: string): string {
  if (upstreamId.length === 0) {
    throw new GatewayError({
      code: 'INTERNAL_ERROR',
      message: `Cannot encode empty upstream id for prefix ${prefix}`,
    })
  }
  const encoded = `${prefix}_${Buffer.from(upstreamId, 'utf8').toString('base64url')}`
  if (encoded.length > MAX_ID_LENGTH) {
    throw new GatewayError({
      code: 'INTERNAL_ERROR',
      message: `Encoded id for prefix ${prefix} exceeds the contract maximum length`,
      details: { prefix, length: encoded.length },
    })
  }
  return encoded
}

/**
 * Decodes a normalized id back to its upstream identifier. Accepts any known
 * prefix so that `mbx_...` and `fld_...` can both reference the same upstream
 * mailbox id.
 */
export function decodeId(normalizedId: string): { prefix: IdPrefix; upstreamId: string } {
  const separator = normalizedId.indexOf('_')
  if (separator <= 0) {
    throw new GatewayError({
      code: 'VALIDATION_FAILED',
      message: `Malformed normalized id: ${normalizedId}`,
      details: { id: normalizedId },
    })
  }
  const prefix = normalizedId.slice(0, separator)
  const body = normalizedId.slice(separator + 1)
  if (!PREFIX_SET.has(prefix)) {
    throw new GatewayError({
      code: 'VALIDATION_FAILED',
      message: `Unknown id prefix: ${prefix}`,
      details: { id: normalizedId },
    })
  }
  const upstreamId = Buffer.from(body, 'base64url').toString('utf8')
  if (upstreamId.length === 0 || encodeId(prefix as IdPrefix, upstreamId) !== normalizedId) {
    throw new GatewayError({
      code: 'VALIDATION_FAILED',
      message: `Malformed normalized id: ${normalizedId}`,
      details: { id: normalizedId },
    })
  }
  return { prefix: prefix as IdPrefix, upstreamId }
}

export function upstreamId(normalizedId: string): string {
  return decodeId(normalizedId).upstreamId
}
