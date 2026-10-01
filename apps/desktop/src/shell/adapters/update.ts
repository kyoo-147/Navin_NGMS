import { UpdatePolicyError } from '../errors'

export interface UpdatePolicyInput {
  readonly enabled: boolean
  readonly endpoints: readonly string[]
  readonly pubkey: string
  readonly allowHosts: readonly string[]
}

export interface UpdatePolicy {
  readonly enabled: boolean
  readonly endpoints: readonly string[]
  readonly allowHosts: readonly string[]
}

function hasControlCharacter(input: string): boolean {
  for (const character of input) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function rawAuthority(input: string): string | null {
  const separator = input.indexOf('://')
  if (separator === -1) return null
  const remainder = input.slice(separator + 3)
  const end = remainder.search(/[/?#]/u)
  return remainder.slice(0, end === -1 ? remainder.length : end)
}

/**
 * Updater configuration is fail-closed. A disabled updater must carry no
 * endpoints or signing key; an enabled updater must be signed and reachable only
 * over HTTPS on an explicitly allow-listed host. Anything ambiguous is rejected.
 */
export function resolveUpdatePolicy(input: UpdatePolicyInput): UpdatePolicy {
  const endpoints = input.endpoints.map((endpoint) => endpoint.trim())
  const pubkey = input.pubkey.trim()
  const allowHosts = input.allowHosts.map((host) => host.trim().toLowerCase())

  if (!input.enabled) {
    if (endpoints.length > 0 || pubkey !== '' || allowHosts.length > 0) {
      throw new UpdatePolicyError(
        'disabled_with_config',
        'disabled updater must not declare endpoints, a pubkey, or allowed hosts',
      )
    }
    return { enabled: false, endpoints: [], allowHosts: [] }
  }

  if (pubkey === '') {
    throw new UpdatePolicyError('missing_pubkey', 'enabled updater requires a signing public key')
  }
  if (endpoints.length === 0) {
    throw new UpdatePolicyError(
      'missing_endpoint',
      'enabled updater requires at least one endpoint',
    )
  }
  if (allowHosts.length === 0) {
    throw new UpdatePolicyError(
      'missing_allowlist',
      'enabled updater requires an explicit host allowlist',
    )
  }

  for (const endpoint of endpoints) {
    if (hasControlCharacter(endpoint)) {
      throw new UpdatePolicyError('invalid_endpoint', 'update endpoint must not contain controls')
    }

    let url: URL
    try {
      url = new URL(endpoint)
    } catch {
      throw new UpdatePolicyError(
        'invalid_endpoint',
        `update endpoint is not a valid URL: "${endpoint}"`,
      )
    }
    const authority = rawAuthority(endpoint)
    if (
      authority === null ||
      authority === '' ||
      authority.endsWith(':') ||
      authority.includes('@') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      throw new UpdatePolicyError(
        authority?.includes('@') || url.username !== '' || url.password !== ''
          ? 'userinfo_present'
          : 'invalid_endpoint',
        authority?.includes('@') || url.username !== '' || url.password !== ''
          ? 'update endpoints must not embed credentials'
          : `update endpoint has a malformed authority: "${authority ?? ''}"`,
      )
    }
    if (url.protocol !== 'https:') {
      throw new UpdatePolicyError(
        'insecure_endpoint',
        `update endpoint must use HTTPS: "${endpoint}"`,
      )
    }
    if (url.hostname === '' || !allowHosts.includes(url.hostname.toLowerCase())) {
      throw new UpdatePolicyError(
        'host_not_allowed',
        `update endpoint host "${url.hostname}" is not in the allowlist`,
      )
    }
  }

  return { enabled: true, endpoints, allowHosts }
}
