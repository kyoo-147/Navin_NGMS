import { createHash, timingSafeEqual } from 'node:crypto'

export function utf8ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'utf8'))
}

export function bytesToUtf8(value: Uint8Array): string {
  return Buffer.from(value).toString('utf8')
}

export function toBase64Url(value: Uint8Array | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
  return buffer.toString('base64url')
}

export function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

export function sha256Hex(value: Uint8Array | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Constant-time comparison of two byte sequences. Length mismatch is reported
 * as `false` without leaking the compared content through timing.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** Constant-time comparison of two hexadecimal strings of equal length. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  return constantTimeEqual(utf8ToBytes(a.toLowerCase()), utf8ToBytes(b.toLowerCase()))
}
