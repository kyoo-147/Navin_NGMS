import { generateUUID } from '../utils/uuid.js'
import type {
  AccountId,
  AliasId,
  EmailAddress,
  IdempotencyKey,
  MailSubmissionRequest,
  MailSubmissionResponse,
} from '@navin/contracts'
import type { DraftRecord } from '@navin/mail-store'

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 // 25 MB

export interface SubmissionOptions {
  fromAddress: EmailAddress
  undoDelaySeconds?: number
  idempotencyKey?: string
}

/**
 * Builds a valid MailSubmissionRequest from a DraftRecord.
 */
export function buildSubmissionRequest(
  draft: DraftRecord,
  options: SubmissionOptions,
): MailSubmissionRequest {
  const totalAttachmentBytes = draft.attachments.reduce((sum, att) => sum + att.size, 0)
  if (totalAttachmentBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Total attachment size (${(totalAttachmentBytes / (1024 * 1024)).toFixed(1)}MB) exceeds limit of 25MB`,
    )
  }

  if (draft.to.length === 0 && draft.cc.length === 0 && draft.bcc.length === 0) {
    throw new Error('At least one recipient is required to submit an email')
  }

  return {
    accountId: draft.accountId as AccountId,
    senderIdentityId: draft.senderIdentityId as AliasId,
    idempotencyKey: (options.idempotencyKey ?? `sub-${generateUUID()}`) as IdempotencyKey,
    from: options.fromAddress,
    to: draft.to.length > 0 ? draft.to : draft.cc, // Must have at least 1 in `to` per contract schema
    cc: draft.cc.length > 0 ? draft.cc : undefined,
    bcc: draft.bcc.length > 0 ? draft.bcc : undefined,
    subject: draft.subject,
    bodyText: draft.bodyText || undefined,
    bodyHtml: draft.bodyHtml || undefined,
    attachments: draft.attachments.length > 0 ? draft.attachments : undefined,
    inReplyTo: draft.inReplyTo,
    references: draft.references.length > 0 ? draft.references : undefined,
    sendAt: draft.sendAt,
    undoDelaySeconds: options.undoDelaySeconds ?? 5,
  }
}

export interface PendingUndo {
  submissionId: string
  expiresAt: number
  timerId: NodeJS.Timeout | number
  promise: Promise<MailSubmissionResponse>
  resolve: (res: MailSubmissionResponse) => void
  reject: (err: Error) => void
  cancelled: boolean
}

/**
 * Manages client-side undo-send window delays before submitting to gateway.
 */
export class UndoSendManager {
  private readonly pending = new Map<string, PendingUndo>()

  /**
   * Schedules a submission after an undo delay. If cancel() is called before the timer
   * fires, the submission is cancelled and the promise resolves or rejects accordingly.
   */
  scheduleWithUndo(
    submissionId: string,
    delaySeconds: number,
    dispatch: () => Promise<MailSubmissionResponse>,
  ): Promise<MailSubmissionResponse> {
    if (delaySeconds <= 0) {
      return dispatch()
    }

    let resolvePromise!: (res: MailSubmissionResponse) => void
    let rejectPromise!: (err: Error) => void

    const promise = new Promise<MailSubmissionResponse>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })

    const timerId = setTimeout(async () => {
      this.pending.delete(submissionId)
      try {
        const result = await dispatch()
        resolvePromise(result)
      } catch (err: unknown) {
        rejectPromise(err instanceof Error ? err : new Error(String(err)))
      }
    }, delaySeconds * 1000)

    this.pending.set(submissionId, {
      submissionId,
      expiresAt: Date.now() + delaySeconds * 1000,
      timerId,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      cancelled: false,
    })

    return promise
  }

  /**
   * Cancels a pending submission during the undo window.
   */
  cancel(submissionId: string): boolean {
    const item = this.pending.get(submissionId)
    if (!item) return false

    clearTimeout(item.timerId)
    item.cancelled = true
    this.pending.delete(submissionId)
    item.reject(new Error('Submission cancelled by user undo'))
    return true
  }

  isPending(submissionId: string): boolean {
    return this.pending.has(submissionId)
  }

  remainingMs(submissionId: string): number {
    const item = this.pending.get(submissionId)
    if (!item) return 0
    return Math.max(0, item.expiresAt - Date.now())
  }
}
