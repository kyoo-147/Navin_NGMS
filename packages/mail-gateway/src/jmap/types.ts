/**
 * Minimal, hand-authored JMAP protocol types (RFC 8620 / RFC 8621 subset) used
 * by the gateway transport and mappers. These are intentionally narrow: only
 * the fields the normalized gateway maps are modelled, and every field is
 * treated as untrusted upstream input.
 */

export type JmapId = string

export interface JmapCoreCapability {
  maxSizeUpload: number
  maxConcurrentUpload: number
  maxSizeRequest: number
  maxConcurrentRequests: number
  maxCallsInRequest: number
  maxObjectsInGet: number
  maxObjectsInSet: number
  collationAlgorithms: string[]
}

export interface JmapMailAccountCapability {
  maxMailboxesPerEmail: number | null
  maxMailboxDepth: number | null
  maxSizeMailboxName: number
  maxSizeAttachmentsPerEmail: number
  emailQuerySortOptions: string[]
  mayCreateTopLevelMailbox: boolean
}

export interface JmapSubmissionAccountCapability {
  maxDelayedSend: number
  submissionExtensions: Record<string, string[]>
}

export interface JmapAccount {
  name: string
  isPersonal: boolean
  isReadOnly: boolean
  accountCapabilities: Record<string, unknown>
}

export interface JmapSession {
  capabilities: Record<string, unknown>
  accounts: Record<string, JmapAccount>
  primaryAccounts: Record<string, string>
  username: string
  apiUrl: string
  downloadUrl: string
  uploadUrl: string
  eventSourceUrl: string
  state: string
}

export interface JmapEmailAddress {
  name: string | null
  email: string
}

export interface JmapEmailBodyPart {
  partId: string | null
  blobId: string
  size: number
  name: string | null
  type: string
  charset: string | null
  disposition: string | null
  cid: string | null
}

export interface JmapBodyValue {
  value: string
  isEncodingProblem: boolean
  isTruncated: boolean
}

export interface JmapEmail {
  id: JmapId
  blobId: string
  threadId: JmapId
  mailboxIds: Record<JmapId, boolean>
  keywords: Record<string, boolean>
  size: number
  receivedAt: string
  messageId: string[] | null
  inReplyTo: string[] | null
  references: string[] | null
  sender: JmapEmailAddress[] | null
  from: JmapEmailAddress[] | null
  to: JmapEmailAddress[] | null
  cc: JmapEmailAddress[] | null
  bcc: JmapEmailAddress[] | null
  replyTo: JmapEmailAddress[] | null
  subject: string | null
  sentAt: string
  hasAttachment: boolean
  preview: string
  bodyValues?: Record<string, JmapBodyValue>
  textBody?: JmapEmailBodyPart[]
  htmlBody?: JmapEmailBodyPart[]
  attachments?: JmapEmailBodyPart[]
}

export interface JmapMailbox {
  id: JmapId
  name: string
  parentId: JmapId | null
  role: string | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
  totalThreads: number
  unreadThreads: number
  isSubscribed: boolean
  myRights: {
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
}

export interface JmapThread {
  id: JmapId
  emailIds: JmapId[]
}

export interface JmapIdentity {
  id: JmapId
  name: string
  email: string
  replyTo: JmapEmailAddress[] | null
  bcc: JmapEmailAddress[] | null
  textSignature: string
  htmlSignature: string
  mayDelete: boolean
}

export type JmapUndoStatus = 'pending' | 'final' | 'canceled'

export interface JmapEmailSubmission {
  id: JmapId
  identityId: JmapId
  emailId: JmapId
  threadId: JmapId | null
  undoStatus: JmapUndoStatus
  sendAt: string | null
  undoWindowExpiresAt: string | null
}

export interface JmapMethodError {
  type: string
  description?: string
  [key: string]: unknown
}

export interface JmapMethodResult {
  name: string
  args: Record<string, unknown>
  callId: string
}

export interface JmapResponse {
  methodResponses: unknown[]
  createdIds?: Record<string, string>
  sessionState: string
}

export interface JmapChanges {
  accountId: JmapId
  oldState: string
  newState: string
  hasMoreChanges: boolean
  created: JmapId[]
  updated: JmapId[]
  destroyed: JmapId[]
}

export interface JmapQueryResult {
  accountId: JmapId
  queryState: string
  canCalculateChanges: boolean
  position: number
  ids: JmapId[]
  total?: number
  limit?: number
}

export interface JmapGetResult<T> {
  accountId: JmapId
  state: string
  list: T[]
  notFound: JmapId[]
}

export interface JmapSetResult {
  accountId: JmapId
  oldState: string | null
  newState: string
  created: Record<JmapId, unknown> | null
  updated: Record<JmapId, unknown> | null
  destroyed: JmapId[] | null
  notCreated: Record<JmapId, JmapMethodError> | null
  notUpdated: Record<JmapId, JmapMethodError> | null
  notDestroyed: Record<JmapId, JmapMethodError> | null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
