import type { EmailAddress, MailAttachment, MailboxId, MessageId, ThreadId } from '@navin/contracts'
import type {
  JmapBodyValue,
  JmapEmail,
  JmapEmailAddress,
  JmapEmailBodyPart,
} from '../jmap/types.js'
import { encodeId } from './id.js'
import { sanitizeEmailHtml } from './html.js'

const ADDRESS_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Email properties the gateway requests for every normalized read. */
export const EMAIL_GET_PROPERTIES = [
  'id',
  'blobId',
  'threadId',
  'mailboxIds',
  'keywords',
  'size',
  'receivedAt',
  'messageId',
  'inReplyTo',
  'references',
  'sender',
  'from',
  'to',
  'cc',
  'bcc',
  'replyTo',
  'subject',
  'sentAt',
  'hasAttachment',
  'preview',
  'bodyValues',
  'textBody',
  'htmlBody',
  'attachments',
] as const

export interface NormalizedEmail {
  id: MessageId
  threadId: ThreadId
  mailboxIds: MailboxId[]
  keywords: string[]
  isUnread: boolean
  isStarred: boolean
  isDraft: boolean
  isAnswered: boolean
  hasAttachment: boolean
  size: number
  preview: string
  subject: string
  from: EmailAddress[]
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  replyTo: EmailAddress[]
  sentAt: string
  receivedAt: string
  bodyText: string | null
  bodyHtml: string | null
  attachments: MailAttachment[]
  messageId: string[] | null
  inReplyTo: string[] | null
  references: string[] | null
}

export function toEmailAddresses(list: JmapEmailAddress[] | null | undefined): EmailAddress[] {
  if (!Array.isArray(list)) return []
  const out: EmailAddress[] = []
  for (const entry of list) {
    if (!entry || typeof entry.email !== 'string' || !ADDRESS_PATTERN.test(entry.email)) continue
    out.push(
      entry.name && entry.name.length > 0
        ? { name: entry.name, address: entry.email }
        : { address: entry.email },
    )
  }
  return out
}

function bodyFromParts(
  parts: JmapEmailBodyPart[] | undefined,
  bodyValues: Record<string, JmapBodyValue> | undefined,
): string | null {
  if (!Array.isArray(parts) || !bodyValues) return null
  const chunks: string[] = []
  for (const part of parts) {
    if (!part.partId) continue
    const value = bodyValues[part.partId]
    if (value && typeof value.value === 'string' && value.value.length > 0) chunks.push(value.value)
  }
  return chunks.length > 0 ? chunks.join('\n') : null
}

export function toAttachments(parts: JmapEmailBodyPart[] | undefined): MailAttachment[] {
  if (!Array.isArray(parts)) return []
  return parts.map((part) => {
    const attachment: MailAttachment = {
      filename: part.name && part.name.length > 0 ? part.name : 'attachment',
      mimeType: part.type && part.type.length > 0 ? part.type : 'application/octet-stream',
      size: Number.isFinite(part.size) ? part.size : 0,
    }
    if (part.blobId) attachment.blobId = part.blobId
    if (part.cid) attachment.cid = part.cid
    return attachment
  })
}

export function toNormalizedEmail(email: JmapEmail): NormalizedEmail {
  const keywords = email.keywords ?? {}
  const mailboxIds = email.mailboxIds ?? {}
  return {
    id: encodeId('msg', email.id) as MessageId,
    threadId: encodeId('thd', email.threadId) as ThreadId,
    mailboxIds: Object.entries(mailboxIds)
      .filter(([, on]) => on)
      .map(([id]) => encodeId('mbx', id) as MailboxId),
    keywords: Object.entries(keywords)
      .filter(([, on]) => on)
      .map(([keyword]) => keyword),
    isUnread: keywords['$seen'] !== true,
    isStarred: keywords['$flagged'] === true,
    isDraft: keywords['$draft'] === true,
    isAnswered: keywords['$answered'] === true,
    hasAttachment: email.hasAttachment === true,
    size: Number.isFinite(email.size) ? email.size : 0,
    preview: email.preview ?? '',
    subject: email.subject ?? '',
    from: toEmailAddresses(email.from),
    to: toEmailAddresses(email.to),
    cc: toEmailAddresses(email.cc),
    bcc: toEmailAddresses(email.bcc),
    replyTo: toEmailAddresses(email.replyTo),
    sentAt: email.sentAt,
    receivedAt: email.receivedAt,
    bodyText: bodyFromParts(email.textBody, email.bodyValues),
    bodyHtml: sanitizeOptionalHtml(bodyFromParts(email.htmlBody, email.bodyValues)),
    attachments: toAttachments(email.attachments),
    messageId: email.messageId ?? null,
    inReplyTo: email.inReplyTo ?? null,
    references: email.references ?? null,
  }
}

function sanitizeOptionalHtml(value: string | null): string | null {
  return value === null ? null : sanitizeEmailHtml(value)
}
