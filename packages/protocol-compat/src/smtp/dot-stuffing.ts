import { ProtocolError } from '../common/errors.js'
const CR = 0x0d
const LF = 0x0a
const DOT = 0x2e

const CRLF = Buffer.from('\r\n')
const TERMINATOR = Buffer.from('.\r\n')

function toBuffer(input: string | Buffer): Buffer {
  return typeof input === 'string' ? Buffer.from(input, 'utf8') : input
}

/** Rewrites CR, LF and CRLF line endings to canonical CRLF. */
export function normalizeCrlf(input: string | Buffer): Buffer {
  const buffer = toBuffer(input)
  const out: number[] = []
  let index = 0
  while (index < buffer.length) {
    const byte = buffer[index] ?? 0
    if (byte === CR) {
      out.push(CR, LF)
      if ((buffer[index + 1] ?? 0) === LF) index += 1
    } else if (byte === LF) {
      out.push(CR, LF)
    } else {
      out.push(byte)
    }
    index += 1
  }
  return Buffer.from(out)
}

/** Prefixes a '.' to any line that already starts with '.' (RFC 5321 §4.5.2). */
export function dotStuff(input: string | Buffer): Buffer {
  const normalized = normalizeCrlf(input)
  const out: number[] = []
  let atLineStart = true
  for (const byte of normalized) {
    if (atLineStart && byte === DOT) out.push(DOT)
    out.push(byte)
    atLineStart = byte === LF
  }
  return Buffer.from(out)
}

/** Reverses dot-stuffing on received DATA. */
export function stripDotStuffing(input: string | Buffer): Buffer {
  const buffer = toBuffer(input)
  const out: number[] = []
  let atLineStart = true
  for (const byte of buffer) {
    if (atLineStart && byte === DOT) {
      atLineStart = false
      continue
    }
    out.push(byte)
    atLineStart = byte === LF
  }
  return Buffer.from(out)
}

/** Dot-stuffs the body and guarantees it ends with CRLF. */
export function encodeDataBody(input: string | Buffer): Buffer {
  const stuffed = dotStuff(input)
  const endsWithCrlf =
    stuffed.length >= 2 && stuffed[stuffed.length - 2] === CR && stuffed[stuffed.length - 1] === LF
  if (stuffed.length === 0 || !endsWithCrlf) {
    return Buffer.concat([stuffed, CRLF])
  }
  return stuffed
}

/** Produces the full DATA payload, including the terminating `.` line. */
export function prepareData(input: string | Buffer, maxBytes?: number): Buffer {
  if (maxBytes !== undefined) assertPreparedDataSize(input, maxBytes)
  return Buffer.concat([encodeDataBody(input), TERMINATOR])
}

export function assertPreparedDataSize(input: string | Buffer, maxBytes: number): void {
  let bytes = 0
  let atLineStart = true
  let endsWithCrlf = false
  const sourceLength = input.length

  for (let index = 0; index < sourceLength; index += 1) {
    const byte = typeof input === 'string' ? input.charCodeAt(index) : (input[index] ?? 0)
    const next = typeof input === 'string' ? input.charCodeAt(index + 1) : (input[index + 1] ?? 0)
    if (byte === CR) {
      bytes += 2
      if (next === LF) index += 1
      atLineStart = true
      endsWithCrlf = true
      continue
    }
    if (byte === LF) {
      bytes += 2
      atLineStart = true
      endsWithCrlf = true
      continue
    }

    if (atLineStart && byte === DOT) bytes += 1
    if (typeof input === 'string' && byte > 0x7f) {
      const codePoint = input.codePointAt(index) ?? byte
      if (codePoint > 0xffff) {
        bytes += Buffer.byteLength(input.slice(index, index + 2), 'utf8')
        index += 1
      } else {
        bytes += Buffer.byteLength(input[index] ?? '', 'utf8')
      }
    } else {
      bytes += 1
    }
    atLineStart = false
    endsWithCrlf = false
  }

  if (!endsWithCrlf) bytes += 2
  bytes += 3
  if (bytes > maxBytes) {
    throw new ProtocolError('LIMIT_EXCEEDED', 'DATA payload exceeds the configured size limit', {
      protocol: 'smtp',
      details: { size: bytes, limit: maxBytes },
    })
  }
}
