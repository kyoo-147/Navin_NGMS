import { createHmac } from 'node:crypto'
import {
  bytesToUtf8,
  constantTimeEqual,
  fromBase64Url,
  toBase64Url,
  utf8ToBytes,
} from './encoding.js'
import { AuthError } from './errors.js'

export interface TokenHeader {
  alg: 'HS256'
  typ: 'NAVIN'
  kid: string
  iss: string
  aud: string
}

export interface DecodedToken {
  header: TokenHeader
  payload: Record<string, unknown>
  signature: Uint8Array
  signingInput: string
}

/** Upper bound on an accepted compact token, to reject oversized input early. */
export const MAX_TOKEN_LENGTH = 8192

export function hmacSha256(key: Uint8Array, data: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', Buffer.from(key)).update(data).digest())
}

function isBoundedString(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isTokenHeader(value: unknown): value is TokenHeader {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const header = value as Record<string, unknown>
  return (
    header.alg === 'HS256' &&
    header.typ === 'NAVIN' &&
    isBoundedString(header.kid) &&
    isBoundedString(header.iss) &&
    isBoundedString(header.aud)
  )
}

export function signToken(
  payload: Record<string, unknown>,
  key: Uint8Array,
  header: TokenHeader,
): string {
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`
  const signature = hmacSha256(key, signingInput)
  return `${signingInput}.${toBase64Url(signature)}`
}

export function decodeToken(token: unknown): DecodedToken {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new AuthError('INVALID_TOKEN')
  }
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new AuthError('INVALID_TOKEN')
  }
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]
  let header: unknown
  let payload: unknown
  try {
    header = JSON.parse(bytesToUtf8(fromBase64Url(headerPart)))
    payload = JSON.parse(bytesToUtf8(fromBase64Url(payloadPart)))
  } catch {
    throw new AuthError('INVALID_TOKEN')
  }
  if (
    !isTokenHeader(header) ||
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new AuthError('INVALID_TOKEN')
  }
  return {
    header,
    payload: payload as Record<string, unknown>,
    signature: fromBase64Url(signaturePart),
    signingInput: `${headerPart}.${payloadPart}`,
  }
}

export function verifyTokenSignature(decoded: DecodedToken, key: Uint8Array): void {
  const expected = hmacSha256(key, decoded.signingInput)
  if (!constantTimeEqual(expected, decoded.signature)) {
    throw new AuthError('INVALID_TOKEN')
  }
}

export function signingKeyFromSecret(secret: string): Uint8Array {
  return utf8ToBytes(secret)
}
