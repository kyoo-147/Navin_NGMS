import type { EmailAddress, MailSubmissionRequest, MailSubmissionStatus } from '@navin/contracts'
import { GatewayError } from '../errors.js'
import type { JmapEmailAddress, JmapIdentity } from '../jmap/types.js'
import { sanitizeEmailHtml } from './html.js'

/** Capability that gates engine-side scheduled send / undo hold. */
export const SUBMISSION_SCHEDULED_SEND_CAPABILITY = 'urn:example:params:scheduled-send'

export function toJmapAddress(address: EmailAddress): JmapEmailAddress {
  return { name: address.name ?? null, email: address.address }
}

function toJmapAddressArray(list?: EmailAddress[]): JmapEmailAddress[] | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined
  return list.map(toJmapAddress)
}

/**
 * Builds the JMAP Email object that is first persisted as a draft before
 * submission. Body content is carried through `bodyValues` with matching
 * `textBody`/`htmlBody` part references.
 */
export function buildSubmissionEmailCreate(
  request: MailSubmissionRequest,
  draftsMailboxUpstreamId: string,
): Record<string, unknown> {
  const bodyValues: Record<string, unknown> = {}
  const textBody: Record<string, unknown>[] = []
  const htmlBody: Record<string, unknown>[] = []

  if (typeof request.bodyText === 'string' && request.bodyText.length > 0) {
    bodyValues['text'] = { value: request.bodyText }
    textBody.push({ partId: 'text', type: 'text/plain' })
  }
  if (typeof request.bodyHtml === 'string' && request.bodyHtml.length > 0) {
    bodyValues['html'] = { value: sanitizeEmailHtml(request.bodyHtml) }
    htmlBody.push({ partId: 'html', type: 'text/html' })
  }

  const create: Record<string, unknown> = {
    mailboxIds: { [draftsMailboxUpstreamId]: true },
    keywords: { $draft: true },
    from: [toJmapAddress(request.from)],
    subject: request.subject,
    bodyValues,
    textBody,
  }
  if (htmlBody.length > 0) create['htmlBody'] = htmlBody

  const to = toJmapAddressArray(request.to)
  if (to) create['to'] = to
  const cc = toJmapAddressArray(request.cc)
  if (cc) create['cc'] = cc
  const bcc = toJmapAddressArray(request.bcc)
  if (bcc) create['bcc'] = bcc
  const replyTo = toJmapAddressArray(request.replyTo)
  if (replyTo) create['replyTo'] = replyTo

  if (request.attachments && request.attachments.length > 0) {
    create['attachments'] = request.attachments.map((attachment) => {
      if (!attachment.blobId) {
        throw new GatewayError({
          code: 'VALIDATION_FAILED',
          message: `Attachment "${attachment.filename}" is missing a server-side blobId`,
          details: { filename: attachment.filename },
        })
      }
      return {
        blobId: attachment.blobId,
        type: attachment.mimeType,
        name: attachment.filename,
        disposition: 'attachment',
      }
    })
  }

  if (request.inReplyTo) create['inReplyTo'] = [request.inReplyTo]
  if (request.references && request.references.length > 0) create['references'] = request.references
  return create
}

export interface SubmissionStatusPlan {
  status: MailSubmissionStatus
  useScheduledSendExtension: boolean
  sendAt: string | null
  undoDelaySeconds: number
  undoWindowExpiresAt: string | null
}

/**
 * Derives the Navin submission status and whether the engine-side scheduled
 * send/undo extension is required. Scheduled send and undo hold fail closed
 * when the upstream engine does not advertise support.
 */
export function planSubmissionStatus(
  request: MailSubmissionRequest,
  nowMs: number,
  scheduledSendSupported: boolean,
): SubmissionStatusPlan {
  const sendAtMs = request.sendAt ? Date.parse(request.sendAt) : Number.NaN
  const future = Number.isFinite(sendAtMs) && sendAtMs > nowMs
  const undoDelaySeconds = request.undoDelaySeconds ?? 0

  if (future && !scheduledSendSupported) {
    throw new GatewayError({
      code: 'ACTION_BLOCKED',
      message: 'Upstream engine does not support scheduled submission',
      details: { capability: SUBMISSION_SCHEDULED_SEND_CAPABILITY, sendAt: request.sendAt },
    })
  }
  if (undoDelaySeconds > 0 && !scheduledSendSupported) {
    throw new GatewayError({
      code: 'ACTION_BLOCKED',
      message: 'Upstream engine does not support undo-send hold',
      details: { capability: SUBMISSION_SCHEDULED_SEND_CAPABILITY, undoDelaySeconds },
    })
  }

  if (future) {
    return {
      status: 'scheduled',
      useScheduledSendExtension: true,
      sendAt: request.sendAt ?? null,
      undoDelaySeconds: 0,
      undoWindowExpiresAt: null,
    }
  }
  if (undoDelaySeconds > 0) {
    return {
      status: 'held_for_undo',
      useScheduledSendExtension: true,
      sendAt: null,
      undoDelaySeconds,
      undoWindowExpiresAt: new Date(nowMs + Math.min(undoDelaySeconds, 60) * 1000).toISOString(),
    }
  }
  return {
    status: 'sent',
    useScheduledSendExtension: false,
    sendAt: null,
    undoDelaySeconds: 0,
    undoWindowExpiresAt: null,
  }
}

/**
 * Verifies the requested From address is one the selected identity is
 * authorized to send as. The backend is authoritative for this check.
 */
export function assertSenderAuthorized(identity: JmapIdentity, from: EmailAddress): void {
  if (identity.email.toLowerCase() !== from.address.toLowerCase()) {
    throw new GatewayError({
      code: 'FORBIDDEN',
      message: 'Requested From address is not authorized for the selected sender identity',
      details: { identityId: identity.id },
    })
  }
}
