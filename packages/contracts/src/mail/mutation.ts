import { Type, type Static } from '@sinclair/typebox'
import { AccountIdSchema, IdempotencyKeySchema, FolderIdSchema } from '../common/id.js'

export const StandardMutationTypeSchema = Type.Union([
  Type.Literal('mark_read'),
  Type.Literal('mark_unread'),
  Type.Literal('star'),
  Type.Literal('unstar'),
  Type.Literal('archive'),
  Type.Literal('trash'),
  Type.Literal('restore'),
  Type.Literal('delete'),
])
export type StandardMutationType = Static<typeof StandardMutationTypeSchema>

export const FolderMutationTypeSchema = Type.Union([Type.Literal('move'), Type.Literal('copy')])
export type FolderMutationType = Static<typeof FolderMutationTypeSchema>

export const LabelMutationTypeSchema = Type.Union([
  Type.Literal('apply_label'),
  Type.Literal('remove_label'),
])
export type LabelMutationType = Static<typeof LabelMutationTypeSchema>

export const MailMutationTypeSchema = Type.Union([
  StandardMutationTypeSchema,
  FolderMutationTypeSchema,
  LabelMutationTypeSchema,
])
export type MailMutationType = Static<typeof MailMutationTypeSchema>

export const StandardMailMutationRequestSchema = Type.Object(
  {
    accountId: AccountIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    mutation: StandardMutationTypeSchema,
    targetIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  { additionalProperties: false },
)
export type StandardMailMutationRequest = Static<typeof StandardMailMutationRequestSchema>

export const FolderMailMutationRequestSchema = Type.Object(
  {
    accountId: AccountIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    mutation: FolderMutationTypeSchema,
    targetIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    destinationFolderId: FolderIdSchema,
  },
  { additionalProperties: false },
)
export type FolderMailMutationRequest = Static<typeof FolderMailMutationRequestSchema>

export const LabelMailMutationRequestSchema = Type.Object(
  {
    accountId: AccountIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    mutation: LabelMutationTypeSchema,
    targetIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    labelIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  { additionalProperties: false },
)
export type LabelMailMutationRequest = Static<typeof LabelMailMutationRequestSchema>

export const MailMutationRequestSchema = Type.Union([
  StandardMailMutationRequestSchema,
  FolderMailMutationRequestSchema,
  LabelMailMutationRequestSchema,
])
export type MailMutationRequest = Static<typeof MailMutationRequestSchema>

export const MailMutationResponseSchema = Type.Object(
  {
    success: Type.Boolean(),
    idempotencyKey: IdempotencyKeySchema,
    affectedCount: Type.Number({ minimum: 0 }),
    undoToken: Type.Optional(Type.String()),
    newState: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)
export type MailMutationResponse = Static<typeof MailMutationResponseSchema>
