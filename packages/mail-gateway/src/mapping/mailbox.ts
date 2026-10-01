import type { FolderId, MailboxId } from '@navin/contracts'
import type { JmapMailbox } from '../jmap/types.js'
import { encodeId } from './id.js'

export type MailboxRole =
  | 'inbox'
  | 'archive'
  | 'drafts'
  | 'sent'
  | 'trash'
  | 'spam'
  | 'all'
  | 'flagged'
  | 'important'
  | 'custom'

const ROLE_MAP: Record<string, MailboxRole> = {
  inbox: 'inbox',
  archive: 'archive',
  drafts: 'drafts',
  sent: 'sent',
  trash: 'trash',
  junk: 'spam',
  spam: 'spam',
  all: 'all',
  flagged: 'flagged',
  important: 'important',
}

export function normalizeMailboxRole(role: string | null | undefined): MailboxRole {
  if (!role) return 'custom'
  return ROLE_MAP[role.toLowerCase()] ?? 'custom'
}

export interface NormalizedMailboxRights {
  mayReadItems: boolean
  mayAddItems: boolean
  mayRemoveItems: boolean
  maySetSeen: boolean
  maySetKeywords: boolean
  mayCreateChild: boolean
  mayRename: boolean
  mayDelete: boolean
  maySubmit: boolean
}

export interface NormalizedMailbox {
  id: MailboxId
  folderId: FolderId
  name: string
  parentId: MailboxId | null
  role: MailboxRole
  rawRole: string | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
  totalThreads: number
  unreadThreads: number
  isSubscribed: boolean
  rights: NormalizedMailboxRights
}

export function toNormalizedMailbox(mailbox: JmapMailbox): NormalizedMailbox {
  return {
    id: encodeId('mbx', mailbox.id) as MailboxId,
    folderId: encodeId('fld', mailbox.id) as FolderId,
    name: mailbox.name,
    parentId: mailbox.parentId ? (encodeId('mbx', mailbox.parentId) as MailboxId) : null,
    role: normalizeMailboxRole(mailbox.role),
    rawRole: mailbox.role,
    sortOrder: mailbox.sortOrder,
    totalEmails: mailbox.totalEmails,
    unreadEmails: mailbox.unreadEmails,
    totalThreads: mailbox.totalThreads,
    unreadThreads: mailbox.unreadThreads,
    isSubscribed: mailbox.isSubscribed,
    rights: { ...mailbox.myRights },
  }
}

export function findMailboxByRole(
  mailboxes: readonly JmapMailbox[],
  role: MailboxRole,
): JmapMailbox | undefined {
  return mailboxes.find((mailbox) => normalizeMailboxRole(mailbox.role) === role)
}
