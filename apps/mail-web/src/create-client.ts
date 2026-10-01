import { MailApiClient, bearerAuthContext } from '@navin/api-client'

export interface CreateMailClientOptions {
  baseUrl: string
  /** Reads the current Mail session token. Empty means "not signed in yet". */
  getToken: () => string | undefined
  fetch?: typeof fetch
}

/**
 * Builds a Mail-surface client that always attaches the current session token.
 * The token is read lazily on every request so a login performed after
 * construction is picked up without rebuilding the client.
 */
export function createMailClient(options: CreateMailClientOptions): MailApiClient {
  return new MailApiClient({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    auth: bearerAuthContext({ surface: 'mail', token: () => options.getToken() ?? '' }),
  })
}
