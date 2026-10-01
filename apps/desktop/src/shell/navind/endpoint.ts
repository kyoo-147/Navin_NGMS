import { EndpointPolicyError } from '../errors'

export interface NavindEndpoint {
  /** `scheme://host[:port]` with no path. */
  readonly origin: string
  /** Normalized path prefix without a trailing slash, possibly empty. */
  readonly pathPrefix: string
  readonly scheme: 'http' | 'https'
  readonly host: string
  readonly isLoopback: boolean
}

const LOOPBACK_LITERAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1'])

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '')
  return LOOPBACK_LITERAL_HOSTS.has(normalized)
}

export function baseUrlOf(endpoint: NavindEndpoint): string {
  return endpoint.pathPrefix ? `${endpoint.origin}${endpoint.pathPrefix}` : endpoint.origin
}

function hasControlCharacter(input: string): boolean {
  for (const character of input) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function hasUnsafePathSyntax(input: string): boolean {
  if (input.includes('\\') || /%(?:2f|5c)/iu.test(input)) return true
  const separator = input.indexOf('://')
  if (separator === -1) return false
  const remainder = input.slice(separator + 3)
  const pathStart = remainder.search(/[/?#]/u)
  if (pathStart === -1 || remainder[pathStart] !== '/') return false
  const path = remainder.slice(pathStart).split(/[?#]/u, 1)[0] ?? ''
  return path.split('/').some((segment) => /^(?:\.|%2e){1,2}$/iu.test(segment))
}

function rawAuthority(input: string): string | null {
  const separator = input.indexOf('://')
  if (separator === -1) return null
  const authorityStart = separator + 3
  const remainder = input.slice(authorityStart)
  const end = remainder.search(/[/?#]/u)
  return remainder.slice(0, end === -1 ? remainder.length : end)
}

function rawAuthorityHost(authority: string): string | null {
  if (authority === '' || authority.includes('@')) return null
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end === -1) return null
    const port = authority.slice(end + 1)
    if (port !== '' && !/^:\d+$/u.test(port)) return null
    return authority.slice(0, end + 1).toLowerCase()
  }

  const colon = authority.indexOf(':')
  if (colon === -1) return authority.toLowerCase()
  if (authority.indexOf(':', colon + 1) !== -1) return null
  const host = authority.slice(0, colon)
  const port = authority.slice(colon + 1)
  if (host === '' || !/^\d+$/u.test(port)) return null
  return host.toLowerCase()
}

/**
 * Endpoint policy for navind connectivity. URL is the platform standard URL
 * parser on the renderer side; pre-normalization checks prevent it from hiding
 * controls, backslashes, traversal segments, encoded separators, empty ports,
 * or ambiguous numeric hosts. Plaintext is limited to literal IP loopback.
 */
export function parseNavindEndpoint(input: string): NavindEndpoint {
  if (hasControlCharacter(input) || hasUnsafePathSyntax(input)) {
    throw new EndpointPolicyError(
      'invalid_url',
      'navind endpoints contain forbidden controls or path syntax',
    )
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new EndpointPolicyError('invalid_url', `Not a valid absolute navind URL: "${input}"`)
  }

  const authority = rawAuthority(input)
  if (authority === null || authority === '') {
    throw new EndpointPolicyError('invalid_url', `Not a valid absolute navind URL: "${input}"`)
  }
  if (authority.includes('@') || url.username !== '' || url.password !== '') {
    throw new EndpointPolicyError('userinfo_present', 'navind endpoints must not embed credentials')
  }
  if (rawAuthorityHost(authority) === null) {
    throw new EndpointPolicyError('invalid_url', `Malformed navind authority: "${authority}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new EndpointPolicyError(
      'scheme_not_permitted',
      `Unsupported scheme "${url.protocol}" for a navind endpoint`,
    )
  }
  if (url.hostname === '') {
    throw new EndpointPolicyError('missing_host', 'navind endpoint must include a host')
  }
  if (url.search !== '' || url.hash !== '') {
    throw new EndpointPolicyError(
      'query_or_fragment',
      'navind endpoint must not include a query string or fragment',
    )
  }

  const scheme = url.protocol === 'https:' ? 'https' : 'http'
  const literalHost = rawAuthorityHost(authority) ?? ''
  const isLoopback = isLoopbackHost(url.hostname)
  if (scheme === 'http' && literalHost !== '127.0.0.1' && literalHost !== '[::1]') {
    throw new EndpointPolicyError(
      'plaintext_remote',
      `Refusing plaintext HTTP navind endpoint for non-loopback host "${url.hostname}"`,
    )
  }

  return {
    origin: url.origin,
    pathPrefix: url.pathname.replace(/\/+$/u, ''),
    scheme,
    host: url.hostname,
    isLoopback,
  }
}
