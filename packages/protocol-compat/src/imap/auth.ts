import { ProtocolError } from '../common/errors.js'
import {
  encodeLoginPassword,
  encodeLoginUsername,
  encodePlain,
  encodeXoauth2,
  type SaslCredentials,
} from '../common/sasl.js'

export type ImapAuthMechanism = 'PLAIN' | 'LOGIN' | 'XOAUTH2'

export const IMAP_AUTH_MECHANISMS: readonly ImapAuthMechanism[] = ['PLAIN', 'LOGIN', 'XOAUTH2']

export function isImapAuthMechanism(value: string): value is ImapAuthMechanism {
  return (IMAP_AUTH_MECHANISMS as readonly string[]).includes(value.toUpperCase())
}

/** The capability token (e.g. `AUTH=PLAIN`) that must be advertised for a mechanism. */
export function imapAuthCapability(mechanism: ImapAuthMechanism): string {
  return `AUTH=${mechanism}`
}

/**
 * The optional SASL initial client response. LOGIN returns `null` because the
 * username is sent in reply to the server's first continuation.
 */
export function imapInitialResponse(
  mechanism: ImapAuthMechanism,
  credentials: SaslCredentials,
): string | null {
  switch (mechanism) {
    case 'PLAIN':
      return encodePlain(credentials)
    case 'XOAUTH2':
      return encodeXoauth2(credentials)
    case 'LOGIN':
      return null
    default:
      throw new ProtocolError('AUTH_UNSUPPORTED', `Unsupported IMAP SASL mechanism: ${mechanism}`, {
        protocol: 'imap',
      })
  }
}

/**
 * The response to a server `+` continuation for a given step. LOGIN sends the
 * username first and the password second; other mechanisms have no continuation.
 */
export function imapContinuationResponse(
  mechanism: ImapAuthMechanism,
  credentials: SaslCredentials,
  step: number,
): string | null {
  if (mechanism === 'LOGIN') {
    return step === 0 ? encodeLoginUsername(credentials) : encodeLoginPassword(credentials)
  }
  return null
}
