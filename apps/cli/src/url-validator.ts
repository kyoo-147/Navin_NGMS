/**
 * Validates the API URL before attaching bearer token to prevent token exfiltration or leaking.
 *
 * Rules:
 * - HTTPS is required for remote hosts.
 * - Plaintext HTTP is ONLY allowed to canonical literal 127.0.0.1 or [::1].
 * - Plaintext localhost is rejected (avoids DNS rebinding / uncanonical resolution).
 * - Credentials (userinfo) in URL are rejected.
 * - Query strings and fragments/hash are rejected.
 * - Directory traversal ('..', '.') and encoded separators (%2f, %5c, %2e, backslashes) are rejected.
 * - Ambiguous numeric/octal/hex/shorthand IPs are rejected (e.g. 0177.0.0.1, 2130706433, 127.1).
 */
export function assertSafeApiUrlForToken(rawUrl: string): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Insecure API URL: URL must be a non-empty string')
  }

  const trimmed = rawUrl.trim()

  // 1. Reject encoded separators and directory traversal sequences in raw string
  const lower = trimmed.toLowerCase()
  if (
    lower.includes('%2f') ||
    lower.includes('%5c') ||
    lower.includes('%2e') ||
    lower.includes('\\') ||
    lower.includes('/../') ||
    lower.endsWith('/..') ||
    lower.includes('/./') ||
    lower.endsWith('/.')
  ) {
    throw new Error(
      `Insecure API URL: path traversal or encoded separators detected in "${rawUrl}"`,
    )
  }

  // 2. Parse URL
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`Insecure API URL: malformed URL "${rawUrl}"`)
  }

  // 3. Scheme check
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(
      `Insecure API URL: scheme "${parsed.protocol}" is forbidden; only HTTPS and canonical loopback HTTP are allowed`,
    )
  }

  // 4. Reject credentials (username/password)
  if (parsed.username || parsed.password) {
    throw new Error(`Insecure API URL: credentials in URL are strictly forbidden`)
  }

  // 5. Reject query parameters and hash/fragment
  if (parsed.search || parsed.hash) {
    throw new Error(`Insecure API URL: query parameters and fragments are strictly forbidden`)
  }

  // 6. Path check
  if (
    parsed.pathname.includes('//') ||
    parsed.pathname.includes('/./') ||
    parsed.pathname.includes('/../')
  ) {
    throw new Error(`Insecure API URL: path contains invalid or unnormalized segments`)
  }

  // 7. Protocol and Host validation
  if (parsed.protocol === 'http:') {
    // Preserve the original authority so URL normalization cannot turn an
    // ambiguous numeric spelling into an apparently canonical loopback.
    const authority = trimmed.slice('http://'.length).split(/[/?#]/, 1)[0] ?? ''
    const rawHost = authority.startsWith('[')
      ? authority.slice(0, authority.indexOf(']') + 1)
      : (authority.split(':', 1)[0] ?? '')

    // Explicitly reject localhost
    if (rawHost.toLowerCase() === 'localhost' || parsed.hostname.toLowerCase() === 'localhost') {
      throw new Error(
        `Insecure API URL: plaintext HTTP to localhost is rejected; use canonical literal 127.0.0.1 or [::1]`,
      )
    }

    // Must be strictly canonical literal 127.0.0.1 or [::1]
    const isCanonicalIpv4 = rawHost === '127.0.0.1' && parsed.hostname === '127.0.0.1'
    const isCanonicalIpv6 =
      (rawHost === '[::1]' || rawHost === '::1') &&
      (parsed.hostname === '[::1]' || parsed.hostname === '::1')

    if (!isCanonicalIpv4 && !isCanonicalIpv6) {
      throw new Error(
        `Insecure API URL: plaintext HTTP is only permitted to canonical literal 127.0.0.1 or [::1] (rejected "${rawHost}")`,
      )
    }
  } else if (parsed.protocol === 'https:') {
    // HTTPS remote allowed
    if (!parsed.hostname || parsed.hostname.includes('%')) {
      throw new Error(`Insecure API URL: invalid HTTPS hostname in "${rawUrl}"`)
    }
  }

  return parsed
}
