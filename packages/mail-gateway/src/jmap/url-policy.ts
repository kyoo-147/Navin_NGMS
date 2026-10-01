import { isIP } from 'node:net'
import { GatewayError } from '../errors.js'
import { isRecord } from './types.js'

export interface ValidatedJmapUrls {
  sessionUrl: string
  apiUrl: string
  uploadUrl: string
  downloadUrl: string
  eventSourceUrl: string
}

const PRIVATE_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan']
const URL_FIELDS = ['apiUrl', 'uploadUrl', 'downloadUrl', 'eventSourceUrl'] as const

type UrlField = (typeof URL_FIELDS)[number]

function fail(field: string, reason: string): never {
  throw new GatewayError({
    code: 'VALIDATION_FAILED',
    message: `JMAP ${field} URL is not allowed: ${reason}`,
    details: { field, reason },
  })
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

function isLoopbackIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  return (
    octets.length === 4 &&
    hostname.split('.').every((part, index) => String(octets[index]) === part) &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    octets[0] === 127
  )
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (
    octets.length !== 4 ||
    !octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  )
    return false
  const a = octets[0] ?? -1
  const b = octets[1] ?? -1
  return (
    a === 0 ||
    a === 127 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.toLowerCase()
  return (
    value === '::1' ||
    value === '::' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe8') ||
    value.startsWith('fe9') ||
    value.startsWith('fea') ||
    value.startsWith('feb') ||
    value.startsWith('ff') ||
    (value.startsWith('::ffff:') && isPrivateIpv4(value.slice('::ffff:'.length)))
  )
}

function isPrivateLiteral(hostname: string): boolean {
  const kind = isIP(hostname)
  return kind === 4 ? isPrivateIpv4(hostname) : kind === 6 && isPrivateIpv6(hostname)
}

function rawHostname(value: string): string {
  const schemeEnd = value.indexOf('://')
  const authority = value.slice(schemeEnd + 3).split(/[/?#]/, 1)[0] ?? ''
  if (authority.startsWith('[')) return authority.slice(1, authority.indexOf(']'))
  return authority.split(':', 1)[0] ?? ''
}

function validatePath(value: string, field: string): void {
  // Backslashes and encoded separators/dot segments are rejected before URL
  // parsing can normalize them into a different resource.
  if (
    value.includes('\\') ||
    [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code < 0x20 || code === 0x7f
    })
  )
    fail(field, 'control-character-or-backslash')
  if (/%(?:2f|2e|5c)/i.test(value)) fail(field, 'encoded-path-separator')
}

/**
 * Validate an upstream URL before it reaches fetch. Remote JMAP endpoints
 * must use HTTPS. The sole HTTP exception is a literal IPv4/IPv6 loopback,
 * which keeps hermetic local engines possible without allowing DNS aliases.
 */
export function validateJmapUrl(value: string, field = 'session'): URL {
  if (typeof value !== 'string' || value.length === 0) fail(field, 'missing')
  validatePath(value, field)

  let url: URL
  try {
    url = new URL(value)
  } catch {
    fail(field, 'invalid-absolute-url')
  }
  if (url.username || url.password) fail(field, 'credentials-not-allowed')
  if (/[?#]/.test(value) || url.search || url.hash) fail(field, 'query-or-fragment-not-allowed')

  const hostname = normalizedHostname(url)
  const literalKind = isIP(hostname)
  const loopback =
    literalKind === 4 ? isLoopbackIpv4(hostname) : literalKind === 6 && hostname === '::1'

  if (url.protocol === 'http:') {
    const literalHost = rawHostname(value).toLowerCase()
    const literalLoopback = isLoopbackIpv4(literalHost) || literalHost === '::1'
    if (!loopback || !literalLoopback) fail(field, 'http-only-allowed-for-literal-loopback')
  } else if (url.protocol === 'https:') {
    if (
      hostname === 'localhost' ||
      PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    )
      fail(field, 'private-hostname')
    if (literalKind !== 0 && isPrivateLiteral(hostname)) fail(field, 'private-literal-target')
  } else {
    fail(field, 'scheme-must-be-http-or-https')
  }

  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(value) || url.pathname.includes('//'))
    fail(field, 'ambiguous-path')
  return url
}

function resolveUrl(value: string, base: URL, field: UrlField): string {
  let resolved: URL
  try {
    resolved = new URL(value, base)
  } catch {
    fail(field, 'invalid-relative-url')
  }
  validateJmapUrl(resolved.toString(), field)
  if (resolved.origin !== base.origin) fail(field, 'origin-mismatch')
  return resolved.toString()
}

/** Validate and strictly resolve every URL in a JMAP session document. */
export function validateAndResolveJmapSession(
  sessionValue: string,
  payload: unknown,
): ValidatedJmapUrls {
  const session = validateJmapUrl(sessionValue, 'session')
  if (!isRecord(payload)) fail('session', 'malformed-session')

  const resolved: Record<UrlField, string> = {} as Record<UrlField, string>
  for (const field of URL_FIELDS) {
    const value = payload[field]
    if (typeof value !== 'string' || value.length === 0) fail(field, 'missing')
    resolved[field] = resolveUrl(value, session, field)
  }
  return {
    sessionUrl: session.toString(),
    ...resolved,
  }
}

/** Ensure a fetch response did not cross the URL origin or redirect boundary. */
export function assertJmapResponseUrl(
  responseUrl: string,
  requestedUrl: string,
  field = 'upstream',
): void {
  if (responseUrl.length === 0) return
  const requested = validateJmapUrl(requestedUrl, field)
  const response = validateJmapUrl(responseUrl, `${field}-response`)
  if (response.origin !== requested.origin) fail(`${field}-response`, 'origin-mismatch')
  if (response.toString() !== requested.toString())
    fail(`${field}-response`, 'redirect-not-allowed')
}
