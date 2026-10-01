import type { MailMutationRequest } from '@navin/contracts'
import { GatewayError } from '../errors.js'
import type { JmapEmail, JmapMailbox } from '../jmap/types.js'
import { upstreamId } from './id.js'
import { findMailboxByRole } from './mailbox.js'

export interface PlannedEmailSet {
  update: Record<string, Record<string, unknown>>
  destroy: string[]
  affected: number
}

export interface MutationPlanningInput {
  mutation: MailMutationRequest
  targets: ReadonlyArray<{ upstreamId: string; email: JmapEmail }>
  mailboxes: readonly JmapMailbox[]
}

function requireMailbox(mailbox: JmapMailbox | undefined, role: string): JmapMailbox {
  if (!mailbox) {
    throw new GatewayError({
      code: 'ACTION_BLOCKED',
      message: `Upstream account has no ${role} mailbox required for this mutation`,
      details: { role },
    })
  }
  return mailbox
}

/**
 * Translates a normalized mutation into a JMAP Email/set patch set. Mailbox
 * membership is expressed through `mailboxIds/<id>` add/remove patches and
 * flags through `keywords/<flag>`, matching RFC 8621 §4.6 patch semantics.
 */
export function planEmailSetMutation(input: MutationPlanningInput): PlannedEmailSet {
  const { mutation, targets, mailboxes } = input
  const update: Record<string, Record<string, unknown>> = {}
  const destroy: string[] = []

  if (mutation.mutation === 'delete') {
    for (const target of targets) destroy.push(target.upstreamId)
    return { update, destroy, affected: destroy.length }
  }

  const destination =
    'destinationFolderId' in mutation ? upstreamId(mutation.destinationFolderId) : undefined
  const labelIds = 'labelIds' in mutation ? mutation.labelIds.map(upstreamId) : undefined

  const inbox =
    mutation.mutation === 'archive' || mutation.mutation === 'restore'
      ? requireMailbox(findMailboxByRole(mailboxes, 'inbox'), 'inbox')
      : undefined
  const trash =
    mutation.mutation === 'trash'
      ? requireMailbox(findMailboxByRole(mailboxes, 'trash'), 'trash')
      : undefined

  for (const target of targets) {
    const patch: Record<string, unknown> = {}
    const currentMailboxes = Object.entries(target.email.mailboxIds ?? {})
      .filter(([, on]) => on)
      .map(([id]) => id)

    switch (mutation.mutation) {
      case 'mark_read':
        patch['keywords/$seen'] = true
        break
      case 'mark_unread':
        patch['keywords/$seen'] = null
        break
      case 'star':
        patch['keywords/$flagged'] = true
        break
      case 'unstar':
        patch['keywords/$flagged'] = null
        break
      case 'archive':
        for (const mailboxId of currentMailboxes) {
          if (inbox && mailboxId === inbox.id) patch[`mailboxIds/${mailboxId}`] = null
        }
        patch['keywords/$inbox'] = null
        break
      case 'trash':
        for (const mailboxId of currentMailboxes) {
          if (trash && mailboxId !== trash.id) patch[`mailboxIds/${mailboxId}`] = null
        }
        if (trash) patch[`mailboxIds/${trash.id}`] = true
        break
      case 'restore':
        for (const mailboxId of currentMailboxes) {
          if (inbox && mailboxId !== inbox.id) patch[`mailboxIds/${mailboxId}`] = null
        }
        if (inbox) patch[`mailboxIds/${inbox.id}`] = true
        break
      case 'move':
        for (const mailboxId of currentMailboxes) {
          if (destination && mailboxId !== destination) patch[`mailboxIds/${mailboxId}`] = null
        }
        if (destination) patch[`mailboxIds/${destination}`] = true
        break
      case 'copy':
        if (destination) patch[`mailboxIds/${destination}`] = true
        break
      case 'apply_label':
        for (const labelId of labelIds ?? []) patch[`mailboxIds/${labelId}`] = true
        break
      case 'remove_label':
        for (const labelId of labelIds ?? []) patch[`mailboxIds/${labelId}`] = null
        break
    }

    if (Object.keys(patch).length > 0) update[target.upstreamId] = patch
  }

  return { update, destroy, affected: targets.length }
}
