import { ProtocolError } from './errors.js'

export interface SaslPasswordCredentials {
  username: string
  password: string
}

export interface SaslTokenCredentials {
  username: string
  accessToken: string
}

export type SaslCredentials = SaslPasswordCredentials | SaslTokenCredentials

export function isTokenCredentials(value: SaslCredentials): value is SaslTokenCredentials {
  return typeof (value as SaslTokenCredentials).accessToken === 'string'
}

const NUL = String.fromCharCode(0)
const SOH = String.fromCharCode(1)

/** base64 of `Username:` — the first SMTP/IMAP SASL LOGIN server challenge. */
export const SASL_LOGIN_USERNAME_CHALLENGE = Buffer.from('Username:').toString('base64')
/** base64 of `Password:` — the second SMTP/IMAP SASL LOGIN server challenge. */
export const SASL_LOGIN_PASSWORD_CHALLENGE = Buffer.from('Password:').toString('base64')

export function base64Encode(input: string | Buffer): string {
  return Buffer.isBuffer(input)
    ? input.toString('base64')
    : Buffer.from(input, 'utf8').toString('base64')
}

export function base64Decode(input: string): Buffer {
  return Buffer.from(input, 'base64')
}

/** RFC 4616 PLAIN: `authzid NUL authcid NUL passwd` with an empty authzid. */
export function encodePlain(credentials: SaslCredentials): string {
  if (isTokenCredentials(credentials)) {
    throw new ProtocolError('AUTH_UNSUPPORTED', 'SASL PLAIN requires password credentials', {
      protocol: 'imap',
    })
  }
  return base64Encode(`${NUL}${credentials.username}${NUL}${credentials.password}`)
}

/** SASL LOGIN first response: the username, base64 encoded. */
export function encodeLoginUsername(credentials: SaslCredentials): string {
  return base64Encode(credentials.username)
}

/** SASL LOGIN second response: the password (or token), base64 encoded. */
export function encodeLoginPassword(credentials: SaslCredentials): string {
  const secret = isTokenCredentials(credentials) ? credentials.accessToken : credentials.password
  return base64Encode(secret)
}

/** RFC 7628 XOAUTH2 initial client response. */
export function encodeXoauth2(credentials: SaslCredentials): string {
  if (!isTokenCredentials(credentials)) {
    throw new ProtocolError('AUTH_UNSUPPORTED', 'XOAUTH2 requires token credentials', {
      protocol: 'imap',
    })
  }
  const payload = `user=${credentials.username}${SOH}auth=Bearer ${credentials.accessToken}${SOH}${SOH}`
  return base64Encode(payload)
}

export function decodeBase64Utf8(input: string): string {
  return base64Decode(input).toString('utf8')
}
