import type { SessionRecord } from '@navin/auth'
import type { CredentialProvider, UpstreamJmapCredential } from '@navin/mail-gateway'

export interface SessionLookup {
  getSession(sessionId: string): SessionRecord | undefined
}

/** Server-side upstream mail binding for one mailbox. */
export interface MailAccountBinding {
  readonly email: string
  readonly sessionUrl: string
  readonly authorization: string
}

/**
 * Resolves the upstream JMAP credential for a Navin Mail session.
 *
 * The upstream session URL and Authorization value never leave the server: the
 * gateway only ever receives a Navin session id, and a credential is returned
 * solely when the persisted session is an active Mail session bound to the
 * configured mailbox. Any other session resolves to `null`, so the gateway
 * fails closed with `UNAUTHORIZED` instead of contacting an upstream engine.
 */
export class MailAccountCredentialProvider implements CredentialProvider {
  constructor(
    private readonly sessions: SessionLookup,
    private readonly account: MailAccountBinding,
  ) {}

  async resolve(sessionId: string): Promise<UpstreamJmapCredential | null> {
    const session = this.sessions.getSession(sessionId)
    if (!session || session.relyingParty !== 'navin-mail' || session.revokedAt) return null
    if (session.email.toLowerCase() !== this.account.email.toLowerCase()) return null
    return { sessionUrl: this.account.sessionUrl, authorization: this.account.authorization }
  }
}
