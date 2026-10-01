/**
 * Server-side credential isolation boundary.
 *
 * The gateway only ever receives a Navin-level session identifier from its
 * caller. The upstream JMAP session URL and Authorization header are resolved
 * server-side by a {@link CredentialProvider} and are used exclusively by the
 * transport. They are never accepted from, returned to, or serialized into any
 * client-facing result.
 */
export interface UpstreamJmapCredential {
  readonly sessionUrl: string
  readonly authorization: string
}

export interface CredentialProvider {
  resolve(sessionId: string): Promise<UpstreamJmapCredential | null>
}

export function bearerAuthorization(token: string): string {
  return `Bearer ${token}`
}

export function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

/**
 * Non-secret description of a credential for diagnostics. Never returns the
 * Authorization value.
 */
export function describeCredential(credential: UpstreamJmapCredential): {
  sessionUrl: string
  scheme: string
} {
  const scheme = credential.authorization.split(' ', 1)[0] ?? 'unknown'
  let sessionUrl = '[invalid]'
  try {
    const url = new URL(credential.sessionUrl)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    sessionUrl = url.toString()
  } catch {
    // Keep diagnostics non-sensitive even when the configured URL is invalid.
  }
  return { sessionUrl, scheme }
}

export class InMemoryCredentialProvider implements CredentialProvider {
  private readonly entries = new Map<string, UpstreamJmapCredential>()

  set(sessionId: string, credential: UpstreamJmapCredential): void {
    this.entries.set(sessionId, credential)
  }

  delete(sessionId: string): boolean {
    return this.entries.delete(sessionId)
  }

  async resolve(sessionId: string): Promise<UpstreamJmapCredential | null> {
    return this.entries.get(sessionId) ?? null
  }
}
