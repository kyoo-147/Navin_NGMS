import { Type, type Static } from '@sinclair/typebox'
import {
  AccountIdSchema,
  AuthScopeSchema,
  EmailAddressSchema,
  FolderIdSchema,
  IsoTimestampSchema,
  MailAttachmentSchema,
  MailboxIdSchema,
  MessageIdSchema,
  NavinRoleSchema,
  SessionAssuranceLevelSchema,
  SessionPrincipalSchema,
  ThreadIdSchema,
  UserIdSchema,
} from '@navin/contracts'

/**
 * Endpoint schemas for the Mail BFF. These describe the transport shapes the
 * daemon exposes for the normalized gateway objects; the domain query,
 * mutation and submission payloads themselves remain frozen in
 * `@navin/contracts`.
 */

export const MailboxRoleSchema = Type.Union([
  Type.Literal('inbox'),
  Type.Literal('archive'),
  Type.Literal('drafts'),
  Type.Literal('sent'),
  Type.Literal('trash'),
  Type.Literal('spam'),
  Type.Literal('all'),
  Type.Literal('flagged'),
  Type.Literal('important'),
  Type.Literal('custom'),
])
export type MailboxRole = Static<typeof MailboxRoleSchema>

export const MailMailboxRightsSchema = Type.Object(
  {
    mayReadItems: Type.Boolean(),
    mayAddItems: Type.Boolean(),
    mayRemoveItems: Type.Boolean(),
    maySetSeen: Type.Boolean(),
    maySetKeywords: Type.Boolean(),
    mayCreateChild: Type.Boolean(),
    mayRename: Type.Boolean(),
    mayDelete: Type.Boolean(),
    maySubmit: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type MailMailboxRights = Static<typeof MailMailboxRightsSchema>

export const MailMailboxSchema = Type.Object(
  {
    id: MailboxIdSchema,
    folderId: FolderIdSchema,
    name: Type.String(),
    parentId: Type.Union([MailboxIdSchema, Type.Null()]),
    role: MailboxRoleSchema,
    rawRole: Type.Union([Type.String(), Type.Null()]),
    sortOrder: Type.Number(),
    totalEmails: Type.Number({ minimum: 0 }),
    unreadEmails: Type.Number({ minimum: 0 }),
    totalThreads: Type.Number({ minimum: 0 }),
    unreadThreads: Type.Number({ minimum: 0 }),
    isSubscribed: Type.Boolean(),
    rights: MailMailboxRightsSchema,
  },
  { additionalProperties: false },
)
export type MailMailbox = Static<typeof MailMailboxSchema>

export const MailMailboxListSchema = Type.Object(
  { mailboxes: Type.Array(MailMailboxSchema) },
  { additionalProperties: false },
)
export type MailMailboxList = Static<typeof MailMailboxListSchema>

export const MailMessageSchema = Type.Object(
  {
    id: MessageIdSchema,
    threadId: ThreadIdSchema,
    mailboxIds: Type.Array(MailboxIdSchema),
    keywords: Type.Array(Type.String()),
    isUnread: Type.Boolean(),
    isStarred: Type.Boolean(),
    isDraft: Type.Boolean(),
    isAnswered: Type.Boolean(),
    hasAttachment: Type.Boolean(),
    size: Type.Number({ minimum: 0 }),
    preview: Type.String(),
    subject: Type.String(),
    from: Type.Array(EmailAddressSchema),
    to: Type.Array(EmailAddressSchema),
    cc: Type.Array(EmailAddressSchema),
    bcc: Type.Array(EmailAddressSchema),
    replyTo: Type.Array(EmailAddressSchema),
    sentAt: IsoTimestampSchema,
    receivedAt: IsoTimestampSchema,
    bodyText: Type.Union([Type.String(), Type.Null()]),
    bodyHtml: Type.Union([Type.String(), Type.Null()]),
    attachments: Type.Array(MailAttachmentSchema),
    messageId: Type.Union([Type.Array(Type.String()), Type.Null()]),
    inReplyTo: Type.Union([Type.Array(Type.String()), Type.Null()]),
    references: Type.Union([Type.Array(Type.String()), Type.Null()]),
  },
  { additionalProperties: false },
)
export type MailMessage = Static<typeof MailMessageSchema>

export const MailThreadSchema = Type.Object(
  {
    id: ThreadIdSchema,
    messageIds: Type.Array(MessageIdSchema),
  },
  { additionalProperties: false },
)
export type MailThread = Static<typeof MailThreadSchema>

export const MailAccountSummarySchema = Type.Object(
  {
    accountId: AccountIdSchema,
    name: Type.String(),
    isPersonal: Type.Boolean(),
    isReadOnly: Type.Boolean(),
    mailCapable: Type.Boolean(),
    submissionCapable: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type MailAccountSummary = Static<typeof MailAccountSummarySchema>

export const MailEngineCapabilitiesSchema = Type.Object(
  {
    mail: Type.Boolean(),
    submission: Type.Boolean(),
    vacation: Type.Boolean(),
    contacts: Type.Boolean(),
    calendars: Type.Boolean(),
    scheduledSend: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type MailEngineCapabilities = Static<typeof MailEngineCapabilitiesSchema>

/**
 * Server-authoritative compose/send binding. The From address and sender
 * identity are decided by the daemon, never by the client.
 */
export const MailSenderBindingSchema = Type.Object(
  {
    identityId: Type.String({
      minLength: 3,
      maxLength: 128,
      pattern: '^(?:usr|als)_[a-zA-Z0-9._-]+$',
    }),
    address: Type.String({
      minLength: 3,
      maxLength: 320,
      pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    }),
  },
  { additionalProperties: false },
)
export type MailSenderBinding = Static<typeof MailSenderBindingSchema>

export const MailSessionInfoSchema = Type.Object(
  {
    username: Type.String(),
    state: Type.String(),
    accounts: Type.Array(MailAccountSummarySchema),
    primaryAccountId: Type.Union([AccountIdSchema, Type.Null()]),
    capabilities: MailEngineCapabilitiesSchema,
    sender: Type.Union([MailSenderBindingSchema, Type.Null()]),
  },
  { additionalProperties: false },
)
export type MailSessionInfo = Static<typeof MailSessionInfoSchema>

export const MailLoginRequestSchema = Type.Object(
  {
    email: Type.String({
      minLength: 3,
      maxLength: 320,
      pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    }),
    password: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)
export type MailLoginRequest = Static<typeof MailLoginRequestSchema>

export const MailLoginResponseSchema = Type.Object(
  {
    principal: SessionPrincipalSchema,
    token: Type.Optional(Type.String({ minLength: 1 })),
    expiresAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type MailLoginResponse = Static<typeof MailLoginResponseSchema>

export const MailAuthSessionSchema = Type.Object(
  {
    userId: UserIdSchema,
    accountId: AccountIdSchema,
    email: Type.String({
      minLength: 3,
      maxLength: 320,
      pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    }),
    roles: Type.Array(NavinRoleSchema),
    scopes: Type.Array(AuthScopeSchema),
    relyingParty: Type.Literal('navin-mail'),
    surface: Type.Literal('mail'),
    assuranceLevel: SessionAssuranceLevelSchema,
  },
  { additionalProperties: false },
)
export type MailAuthSession = Static<typeof MailAuthSessionSchema>

export const MailLogoutResponseSchema = Type.Object(
  { loggedOut: Type.Boolean() },
  { additionalProperties: false },
)
export type MailLogoutResponse = Static<typeof MailLogoutResponseSchema>
