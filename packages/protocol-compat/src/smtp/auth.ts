import { ProtocolError } from '../common/errors.js'
import {
  encodeLoginPassword,
  encodeLoginUsername,
  encodePlain,
  encodeXoauth2,
  type SaslCredentials,
} from '../common/sasl.js'

export type SmtpAuthMechanism = 'PLAIN' | 'LOGIN' | 'XOAUTH2'

export const SMTP_AUTH_MECHANISMS: readonly SmtpAuthMechanism[] = ['PLAIN', 'LOGIN', 'XOAUTH2']

export function isSmtpAuthMechanism(value: string): value is SmtpAuthMechanism {
  return (SMTP_AUTH_MECHANISMS as readonly string[]).includes(value.toUpperCase())
}

/** The optional SASL initial response; LOGIN sends none and replies to challenges. */
export function smtpInitialResponse(
  mechanism: SmtpAuthMechanism,
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
      throw new ProtocolError('AUTH_UNSUPPORTED', `Unsupported SMTP SASL mechanism: ${mechanism}`, {
        protocol: 'smtp',
      })
  }
}

export function smtpLoginUsername(credentials: SaslCredentials): string {
  return encodeLoginUsername(credentials)
}

export function smtpLoginPassword(credentials: SaslCredentials): string {
  return encodeLoginPassword(credentials)
}
