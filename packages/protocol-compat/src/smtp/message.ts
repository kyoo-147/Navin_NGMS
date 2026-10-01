import { assertHeaderName, assertMimeBoundary } from '../common/wire.js'
import { randomUUID } from 'node:crypto'
import { ProtocolError } from '../common/errors.js'
import { assertNoControlBytes } from '../common/address.js'
import { base64Encode } from '../common/sasl.js'

export interface Mailbox {
  name?: string
  address: string
}

export type MailboxLike = string | Mailbox

export interface OutgoingMessage {
  from: MailboxLike
  to: MailboxLike[]
  cc?: MailboxLike[]
  bcc?: MailboxLike[]
  replyTo?: MailboxLike[]
  subject: string
  text?: string
  html?: string
  inReplyTo?: string
  references?: string[]
  headers?: Record<string, string>
  date?: Date
  messageId?: string
  boundary?: string
}

const CRLF = '\r\n'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function mailboxAddress(mailbox: MailboxLike): string {
  return typeof mailbox === 'string' ? mailbox : mailbox.address
}

function isPrintableAscii(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code > 0x7e) return false
  }
  return true
}

/** RFC 2047 encodes non-ASCII header text; leaves printable ASCII untouched. */
export function encodeHeaderValue(value: string): string {
  if (isPrintableAscii(value)) return value
  return `=?UTF-8?B?${base64Encode(value)}?=`
}

function formatHeaderMailbox(mailbox: MailboxLike): string {
  const rawAddress = mailboxAddress(mailbox)
  assertNoControlBytes(rawAddress, 'address')
  const address = rawAddress.trim()
  if (address === '') {
    throw new ProtocolError('MESSAGE_REJECTED', 'Empty mailbox address', { protocol: 'smtp' })
  }
  const name = typeof mailbox === 'string' ? undefined : mailbox.name
  if (name === undefined || name === '') return address
  return `${encodeHeaderValue(assertNoControlBytes(name, 'display name'))} <${address}>`
}

function formatDate(date: Date): string {
  const day = DAYS[date.getUTCDay()] ?? 'Sun'
  const month = MONTHS[date.getUTCMonth()] ?? 'Jan'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${day}, ${pad(date.getUTCDate())} ${month} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
}

function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at === -1 ? 'localhost' : address.slice(at + 1)
}

/** Deterministic-ish RFC 5322 builder for SMTP transaction tests. */
export function buildMessage(message: OutgoingMessage, maxBytes?: number): Buffer {
  const fromAddress = mailboxAddress(message.from).trim()
  const headers: string[] = []

  headers.push(`From: ${formatHeaderMailbox(message.from)}`)
  headers.push(`To: ${message.to.map(formatHeaderMailbox).join(', ')}`)
  if (message.cc !== undefined && message.cc.length > 0) {
    headers.push(`Cc: ${message.cc.map(formatHeaderMailbox).join(', ')}`)
  }
  if (message.replyTo !== undefined && message.replyTo.length > 0) {
    headers.push(`Reply-To: ${message.replyTo.map(formatHeaderMailbox).join(', ')}`)
  }
  headers.push(`Subject: ${encodeHeaderValue(assertNoControlBytes(message.subject, 'subject'))}`)
  headers.push(`Date: ${formatDate(message.date ?? new Date())}`)
  const messageId = message.messageId ?? `<${randomUUID()}@${domainOf(fromAddress)}>`
  headers.push(`Message-ID: ${assertNoControlBytes(messageId, 'message-id')}`)
  if (message.inReplyTo !== undefined) {
    headers.push(`In-Reply-To: ${assertNoControlBytes(message.inReplyTo, 'in-reply-to')}`)
  }
  if (message.references !== undefined && message.references.length > 0) {
    const references = message.references.map((value) => assertNoControlBytes(value, 'references'))
    headers.push(`References: ${references.join(' ')}`)
  }
  headers.push('MIME-Version: 1.0')

  const boundary = assertMimeBoundary(message.boundary ?? `navin-${randomUUID()}`)
  const hasText = message.text !== undefined
  const hasHtml = message.html !== undefined

  let body: string
  if (hasText && hasHtml) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.text ?? '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.html ?? '',
      `--${boundary}--`,
      '',
    ].join(CRLF)
  } else if (hasHtml) {
    headers.push('Content-Type: text/html; charset=utf-8')
    headers.push('Content-Transfer-Encoding: 8bit')
    body = message.html ?? ''
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8')
    headers.push('Content-Transfer-Encoding: 8bit')
    body = message.text ?? ''
  }

  if (message.headers !== undefined) {
    for (const [name, value] of Object.entries(message.headers)) {
      assertHeaderName(name)
      headers.push(`${name}: ${assertNoControlBytes(value, `header ${name}`)}`)
    }
  }

  const wireMessage = `${headers.join(CRLF)}${CRLF}${CRLF}${body}`
  const byteLength = Buffer.byteLength(wireMessage, 'utf8')
  if (maxBytes !== undefined && byteLength > maxBytes) {
    throw new ProtocolError('LIMIT_EXCEEDED', 'Message exceeds the configured size limit', {
      protocol: 'smtp',
      details: { size: byteLength, limit: maxBytes },
    })
  }
  return Buffer.from(wireMessage, 'utf8')
}
