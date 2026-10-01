import { ProtocolError } from '../common/errors.js'
import type { ProtocolLimits } from '../common/limits.js'
import type { OperationOptions } from '../common/timeout.js'

/** The incremental byte source required to parse IMAP responses. */
export interface ImapResponseSource {
  readonly limits: ProtocolLimits
  readLine(options?: OperationOptions): Promise<Buffer>
  readExact(bytes: number, options?: OperationOptions): Promise<Buffer>
}

const CRLF = Buffer.from('\r\n')
const LITERAL_SUFFIX = /^([\s\S]*)\{(\d+)\+?\}$/
const STATUS_WORDS = new Set(['OK', 'NO', 'BAD', 'BYE', 'PREAUTH'])

export interface ImapTextSegment {
  kind: 'text'
  text: string
}

export interface ImapLiteralSegment {
  kind: 'literal'
  bytes: Buffer
}

export type ImapSegment = ImapTextSegment | ImapLiteralSegment

export type ImapPrefix =
  { kind: 'tagged'; tag: string } | { kind: 'untagged' } | { kind: 'continuation' }

export type ImapStatus = 'OK' | 'NO' | 'BAD' | 'BYE' | 'PREAUTH'

export interface ImapResponse {
  /** Exact bytes of the complete logical response, including CRLFs and literals. */
  raw: Buffer
  /** Text segments joined with literal payloads inlined (literal markers removed). */
  text: string
  /** Literal payloads in encounter order. */
  literals: Buffer[]
  segments: ImapSegment[]
  prefix: ImapPrefix
  /** Status word for tagged responses and `* OK`/`* NO`/`* BAD`/`* BYE`/`* PREAUTH`. */
  status?: ImapStatus
  /** Name of an untagged data response, e.g. `CAPABILITY` or `FETCH`. */
  untagged?: string
  /** Response text after the prefix token. */
  rest: string
}

/**
 * Reads one complete IMAP response, transparently resolving `{n}` literals. A
 * response ends at the first CRLF-terminated line that is not itself terminated
 * by a literal marker.
 */
export async function readImapResponse(
  connection: ImapResponseSource,
  options: OperationOptions = {},
): Promise<ImapResponse> {
  const limits = connection.limits
  const raws: Buffer[] = []
  const segments: ImapSegment[] = []
  const literals: Buffer[] = []
  let total = 0

  let line = await connection.readLine(options)

  for (;;) {
    total += line.length + 2
    if (total > limits.maxResponseBytes) {
      throw new ProtocolError('LIMIT_EXCEEDED', 'IMAP response exceeded the configured limit', {
        protocol: 'imap',
        details: { limit: limits.maxResponseBytes },
      })
    }

    const lineText = line.toString('latin1')
    raws.push(line, CRLF)

    const match = LITERAL_SUFFIX.exec(lineText)
    if (match === null) {
      segments.push({ kind: 'text', text: lineText })
      break
    }

    const literalLength = Number(match[2] ?? '0')
    if (literalLength > limits.maxLiteralBytes) {
      throw new ProtocolError('LIMIT_EXCEEDED', 'IMAP literal exceeded the configured limit', {
        protocol: 'imap',
        details: { requested: literalLength, limit: limits.maxLiteralBytes },
      })
    }

    segments.push({ kind: 'text', text: match[1] ?? '' })

    const literal = await connection.readExact(literalLength, options)
    total += literal.length
    if (total > limits.maxResponseBytes) {
      throw new ProtocolError('LIMIT_EXCEEDED', 'IMAP response exceeded the configured limit', {
        protocol: 'imap',
        details: { limit: limits.maxResponseBytes },
      })
    }
    segments.push({ kind: 'literal', bytes: literal })
    literals.push(literal)
    raws.push(literal)

    line = await connection.readLine(options)
  }

  const text = segments
    .map((segment) => (segment.kind === 'text' ? segment.text : segment.bytes.toString('utf8')))
    .join('')

  return { raw: Buffer.concat(raws), text, literals, segments, ...classify(text) }
}

function classify(text: string): {
  prefix: ImapPrefix
  status?: ImapStatus
  untagged?: string
  rest: string
} {
  if (text.startsWith('*')) {
    const remainder = text.slice(1).replace(/^ /, '')
    const firstRaw = firstTokenRaw(remainder)
    const firstUpper = firstRaw.toUpperCase()

    if (firstUpper === '') {
      return { prefix: { kind: 'untagged' }, rest: remainder }
    }
    if (STATUS_WORDS.has(firstUpper)) {
      return {
        prefix: { kind: 'untagged' },
        status: firstUpper as ImapStatus,
        rest: remainder.slice(firstRaw.length).replace(/^ /, ''),
      }
    }
    if (/^\d+$/.test(firstRaw)) {
      // `* <n> <NAME> ...` (e.g. `* 1 FETCH ...`); the data name follows the number.
      const afterNumber = remainder.slice(firstRaw.length).replace(/^ /, '')
      const nameRaw = firstTokenRaw(afterNumber)
      return {
        prefix: { kind: 'untagged' },
        untagged: nameRaw.toUpperCase(),
        rest: afterNumber.slice(nameRaw.length).replace(/^ /, ''),
      }
    }
    return {
      prefix: { kind: 'untagged' },
      untagged: firstUpper,
      rest: remainder.slice(firstRaw.length).replace(/^ /, ''),
    }
  }

  if (text.startsWith('+')) {
    return { prefix: { kind: 'continuation' }, rest: text.slice(1).replace(/^ /, '') }
  }

  const tag = firstTokenRaw(text)
  const rest = text.slice(tag.length).replace(/^ /, '')
  const statusWord = firstToken(rest)
  if (tag !== '' && STATUS_WORDS.has(statusWord)) {
    return {
      prefix: { kind: 'tagged', tag },
      status: statusWord as ImapStatus,
      rest: rest.slice(statusWord.length).replace(/^ /, ''),
    }
  }
  return { prefix: { kind: 'tagged', tag }, rest }
}

function firstTokenRaw(value: string): string {
  const end = value.indexOf(' ')
  return end === -1 ? value : value.slice(0, end)
}

function firstToken(value: string): string {
  return firstTokenRaw(value).toUpperCase()
}
