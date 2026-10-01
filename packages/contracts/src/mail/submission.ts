import { Type, type Static } from '@sinclair/typebox'
import {
  AccountIdSchema,
  IdempotencyKeySchema,
  MessageIdSchema,
  AliasIdSchema,
  UserIdSchema,
} from '../common/id.js'
import { IsoTimestampSchema } from '../common/envelope.js'

export const EmailAddressSchema = Type.Object(
  {
    name: Type.Optional(Type.String()),
    address: Type.String({
      minLength: 3,
      maxLength: 320,
      pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
      description: 'Standard RFC email address',
    }),
  },
  { additionalProperties: false },
)
export type EmailAddress = Static<typeof EmailAddressSchema>

export const MailAttachmentSchema = Type.Object(
  {
    filename: Type.String({ minLength: 1 }),
    mimeType: Type.String({ minLength: 1 }),
    size: Type.Number({ minimum: 0 }),
    blobId: Type.Optional(Type.String()),
    cid: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)
export type MailAttachment = Static<typeof MailAttachmentSchema>

export const MailSubmissionStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('scheduled'),
  Type.Literal('sent'),
  Type.Literal('held_for_undo'),
])
export type MailSubmissionStatus = Static<typeof MailSubmissionStatusSchema>

export const MailSubmissionRequestSchema = Type.Object(
  {
    accountId: AccountIdSchema,
    senderIdentityId: Type.Union([AliasIdSchema, UserIdSchema], {
      description:
        'Authorized sender identity or alias ID verified by backend authorization against the current session',
    }),
    idempotencyKey: IdempotencyKeySchema,
    from: EmailAddressSchema,
    to: Type.Array(EmailAddressSchema, { minItems: 1 }),
    cc: Type.Optional(Type.Array(EmailAddressSchema)),
    bcc: Type.Optional(Type.Array(EmailAddressSchema)),
    replyTo: Type.Optional(Type.Array(EmailAddressSchema)),
    subject: Type.String(),
    bodyText: Type.Optional(Type.String()),
    bodyHtml: Type.Optional(Type.String()),
    attachments: Type.Optional(Type.Array(MailAttachmentSchema)),
    inReplyTo: Type.Optional(Type.String()),
    references: Type.Optional(Type.Array(Type.String())),
    sendAt: Type.Optional(IsoTimestampSchema),
    undoDelaySeconds: Type.Optional(Type.Number({ minimum: 0, maximum: 60 })),
  },
  { additionalProperties: false },
)
export type MailSubmissionRequest = Static<typeof MailSubmissionRequestSchema>

export const MailSubmissionResponseSchema = Type.Object(
  {
    submissionId: Type.String({ minLength: 1 }),
    idempotencyKey: IdempotencyKeySchema,
    messageId: MessageIdSchema,
    status: MailSubmissionStatusSchema,
    undoWindowExpiresAt: Type.Optional(IsoTimestampSchema),
    submittedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type MailSubmissionResponse = Static<typeof MailSubmissionResponseSchema>
