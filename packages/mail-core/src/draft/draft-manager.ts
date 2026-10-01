import { generateUUID } from '../utils/uuid.js'
import type { EmailAddress } from '@navin/contracts'
import type { NormalizedEmail } from '@navin/mail-gateway'
import type { DraftRecord } from '@navin/mail-store'

export interface RecipientValidationResult {
  valid: boolean
  errors: string[]
}

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Validates recipient email address format.
 */
export function validateRecipient(recipient: EmailAddress): boolean {
  return EMAIL_REGEX.test(recipient.address)
}

/**
 * Validates all recipients in a draft.
 */
export function validateDraftRecipients(draft: DraftRecord): RecipientValidationResult {
  const errors: string[] = []

  if (draft.to.length === 0 && draft.cc.length === 0 && draft.bcc.length === 0) {
    errors.push('At least one recipient (To, Cc, or Bcc) is required')
  }

  const allRecipients = [...draft.to, ...draft.cc, ...draft.bcc]
  for (const r of allRecipients) {
    if (!validateRecipient(r)) {
      errors.push(`Invalid email address format: "${r.address}"`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

const ATTACHMENT_KEYWORDS = [
  'attach',
  'attached',
  'attaching',
  'attachment',
  'enclosed',
  'enclosing',
  'see file',
]

/**
 * Detects if the body mentions attachments while no attachments are actually attached.
 */
export function detectMissingAttachmentWarning(draft: DraftRecord): boolean {
  if (draft.attachments.length > 0) return false
  const combinedText = `${draft.subject} ${draft.bodyText}`.toLowerCase()
  return ATTACHMENT_KEYWORDS.some((kw) => combinedText.includes(kw))
}

/**
 * Creates a new blank draft.
 */
export function createNewDraft(
  accountId: string,
  senderIdentityId: string,
  initial?: Partial<DraftRecord>,
): DraftRecord {
  const now = new Date().toISOString()
  return {
    id: initial?.id ?? generateUUID(),
    accountId,
    senderIdentityId,
    to: initial?.to ?? [],
    cc: initial?.cc ?? [],
    bcc: initial?.bcc ?? [],
    subject: initial?.subject ?? '',
    bodyText: initial?.bodyText ?? '',
    bodyHtml: initial?.bodyHtml ?? '',
    attachments: initial?.attachments ?? [],
    inReplyTo: initial?.inReplyTo,
    references: initial?.references ?? [],
    sendAt: initial?.sendAt,
    updatedAt: now,
    status: 'draft',
  }
}

/**
 * Creates a reply or reply-all draft from an existing email.
 */
export function createReplyDraft(
  original: NormalizedEmail,
  accountId: string,
  currentUser: EmailAddress,
  replyAll: boolean = false,
): DraftRecord {
  const now = new Date().toISOString()
  const replyToRecipient = original.replyTo[0] ??
    original.from[0] ?? { address: 'unknown@example.invalid' }

  const to: EmailAddress[] = [replyToRecipient]
  const cc: EmailAddress[] = []

  if (replyAll) {
    const userAddr = currentUser.address.toLowerCase()
    const allOriginal = [...original.to, ...original.cc, ...original.from]
    for (const r of allOriginal) {
      const addr = r.address.toLowerCase()
      if (addr !== userAddr && addr !== replyToRecipient.address.toLowerCase()) {
        if (!cc.some((existing) => existing.address.toLowerCase() === addr)) {
          cc.push(r)
        }
      }
    }
  }

  const subject = /^Re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`
  const senderStr = replyToRecipient.name
    ? `${replyToRecipient.name} <${replyToRecipient.address}>`
    : replyToRecipient.address
  const originalHeader = `On ${new Date(original.receivedAt).toLocaleString()}, ${senderStr} wrote:`
  const originalBodyText = original.bodyText ?? ''
  const quotedHtml = `<br><br><div class="gmail_quote"><div>${originalHeader}</div><blockquote>${original.bodyHtml || originalBodyText}</blockquote></div>`
  const quotedText = `\n\n${originalHeader}\n> ${originalBodyText.split('\n').join('\n> ')}`

  return {
    id: generateUUID(),
    accountId,
    senderIdentityId: currentUser.address,
    to,
    cc,
    bcc: [],
    subject,
    bodyText: quotedText,
    bodyHtml: quotedHtml,
    attachments: [],
    inReplyTo: original.id,
    references: [original.id],
    updatedAt: now,
    status: 'draft',
  }
}

/**
 * Creates a forward draft from an existing email.
 */
export function createForwardDraft(
  original: NormalizedEmail,
  accountId: string,
  currentUser: EmailAddress,
): DraftRecord {
  const now = new Date().toISOString()
  const subject = /^Fwd:/i.test(original.subject) ? original.subject : `Fwd: ${original.subject}`
  const originalSender = original.from[0] ?? { address: 'unknown@example.invalid' }
  const senderStr = originalSender.name
    ? `${originalSender.name} &lt;${originalSender.address}&gt;`
    : originalSender.address
  const senderStrText = originalSender.name
    ? `${originalSender.name} <${originalSender.address}>`
    : originalSender.address

  const forwardHeader = `---------- Forwarded message ---------<br>From: ${senderStr}<br>Date: ${new Date(original.receivedAt).toLocaleString()}<br>Subject: ${original.subject}<br>To: ${original.to.map((t) => t.address).join(', ')}<br><br>`
  const forwardHeaderText = `---------- Forwarded message ---------\nFrom: ${senderStrText}\nDate: ${new Date(original.receivedAt).toLocaleString()}\nSubject: ${original.subject}\nTo: ${original.to.map((t) => t.address).join(', ')}\n\n`
  const originalBodyText = original.bodyText ?? ''

  return {
    id: generateUUID(),
    accountId,
    senderIdentityId: currentUser.address,
    to: [],
    cc: [],
    bcc: [],
    subject,
    bodyText: `\n\n${forwardHeaderText}${originalBodyText}`,
    bodyHtml: `<br><br>${forwardHeader}${original.bodyHtml || originalBodyText}`,
    attachments: [...original.attachments],
    inReplyTo: undefined,
    references: [original.id],
    updatedAt: now,
    status: 'draft',
  }
}
