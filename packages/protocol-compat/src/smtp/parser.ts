import { DEFAULT_PROTOCOL_LIMITS, type ProtocolLimits } from '../common/limits.js'
import { ProtocolError } from '../common/errors.js'
import { createDeadline } from '../common/timeout.js'
import type { OperationOptions } from '../common/timeout.js'

/** The line source required to parse SMTP replies. */
export interface SmtpReplySource {
  readonly limits?: Pick<
    ProtocolLimits,
    'commandTimeoutMs' | 'maxResponseBytes' | 'maxResponseLines'
  >
  readLine(options?: OperationOptions): Promise<Buffer>
}

const CRLF = Buffer.from('\r\n')
const REPLY_LINE = /^(\d{3})([ -])(.*)$/

export interface SmtpReply {
  code: number
  /** Reply text for each line, in order, without the leading code/separator. */
  lines: string[]
  /** All reply lines joined with newlines. */
  text: string
  raw: Buffer
}

/**
 * Reads one complete SMTP reply, following RFC 5321 multiline continuation
 * (`250-first` ... `250 last`). The aggregate reply and the entire operation
 * share one byte, line-count and wall-clock budget.
 */
export async function readSmtpReply(
  connection: SmtpReplySource,
  options: OperationOptions = {},
): Promise<SmtpReply> {
  const raws: Buffer[] = []
  const lines: string[] = []
  let code = -1
  const limits = connection.limits ?? DEFAULT_PROTOCOL_LIMITS
  const timeoutMs = options.timeoutMs ?? limits.commandTimeoutMs
  const deadline = createDeadline(options.signal, timeoutMs)
  const startedAt = Date.now()

  try {
    for (;;) {
      const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt))
      const line = await connection.readLine({ signal: deadline.signal, timeoutMs: remainingMs })
      const aggregateBytes = raws.reduce((total, raw) => total + raw.length, 0) + line.length + 2
      if (aggregateBytes > limits.maxResponseBytes) {
        throw new ProtocolError('LIMIT_EXCEEDED', 'SMTP reply exceeded the configured byte limit', {
          protocol: 'smtp',
          details: { bytes: aggregateBytes, limit: limits.maxResponseBytes },
        })
      }
      if (lines.length + 1 > limits.maxResponseLines) {
        throw new ProtocolError('LIMIT_EXCEEDED', 'SMTP reply exceeded the configured line limit', {
          protocol: 'smtp',
          details: { lines: lines.length + 1, limit: limits.maxResponseLines },
        })
      }

      raws.push(line, CRLF)
      const text = line.toString('utf8')
      const match = REPLY_LINE.exec(text)
      if (match === null) {
        throw new ProtocolError('PROTOCOL_ERROR', `Malformed SMTP reply line: ${text}`, {
          protocol: 'smtp',
        })
      }

      const lineCode = Number(match[1])
      const separator = match[2] ?? ' '
      const rest = match[3] ?? ''
      if (code === -1) {
        code = lineCode
      } else if (lineCode !== code) {
        throw new ProtocolError(
          'UNEXPECTED_RESPONSE',
          `Inconsistent SMTP reply codes: ${code} vs ${lineCode}`,
          { protocol: 'smtp' },
        )
      }

      lines.push(rest)
      if (separator === ' ') break
    }
  } finally {
    deadline.dispose()
  }

  return { code, lines, text: lines.join('\n'), raw: Buffer.concat(raws) }
}
