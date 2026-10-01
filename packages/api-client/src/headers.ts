import { ApiConfigurationError } from './errors.js'

/**
 * Headers the client owns. Callers must not set these through `defaultHeaders` or per-request
 * `headers`; doing so is a fail-closed configuration error rather than a silent override.
 */
export const RESERVED_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-navin-surface',
  'x-correlation-id',
  'idempotency-key',
  'content-type',
  'accept',
  'cache-control',
  'last-event-id',
  'user-agent',
  'host',
  'origin',
  'referer',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
] as const

const RESERVED_HEADER_SET: ReadonlySet<string> = new Set(RESERVED_HEADERS)
/** An auth context may only contribute these reserved headers. */
const AUTH_ALLOWED_RESERVED: ReadonlySet<string> = new Set(['authorization', 'cookie', 'x-api-key'])
const EMPTY_ALLOWED: ReadonlySet<string> = new Set()

export function findReservedHeaders(
  headers: Record<string, string>,
  allowed: ReadonlySet<string> = EMPTY_ALLOWED,
): string[] {
  const found: string[] = []
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase()
    if (
      (RESERVED_HEADER_SET.has(lower) ||
        lower.startsWith('sec-') ||
        lower.startsWith('proxy-') ||
        lower.startsWith('x-forwarded-')) &&
      !allowed.has(lower)
    ) {
      found.push(lower)
    }
  }
  return found
}

/**
 * Throws when `headers` tries to set a reserved header. Auth contexts are permitted to set
 * `authorization`/`cookie`; everything else stays owned by the client.
 */
export function assertNoReservedHeaders(
  headers: Record<string, string> | undefined,
  source: string,
  options: { isAuthContext?: boolean } = {},
): void {
  if (!headers) return
  const allowed = options.isAuthContext ? AUTH_ALLOWED_RESERVED : EMPTY_ALLOWED
  const reserved = findReservedHeaders(headers, allowed)
  if (reserved.length > 0) {
    throw new ApiConfigurationError(
      `Reserved header(s) cannot be set via ${source}: ${reserved.join(', ')}`,
    )
  }
}

export function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === target)
}
