import { Type, type Static } from '@sinclair/typebox'
import { AccountIdSchema, MailboxIdSchema, ThreadIdSchema, MessageIdSchema } from '../common/id.js'
import { IsoTimestampSchema } from '../common/envelope.js'

export const MailQuerySortFieldSchema = Type.Union([
  Type.Literal('date'),
  Type.Literal('from'),
  Type.Literal('subject'),
  Type.Literal('size'),
])
export type MailQuerySortField = Static<typeof MailQuerySortFieldSchema>

export const MailQuerySortDirectionSchema = Type.Union([Type.Literal('asc'), Type.Literal('desc')])
export type MailQuerySortDirection = Static<typeof MailQuerySortDirectionSchema>

export const MailQuerySortSchema = Type.Object(
  {
    field: MailQuerySortFieldSchema,
    direction: MailQuerySortDirectionSchema,
  },
  { additionalProperties: false },
)
export type MailQuerySort = Static<typeof MailQuerySortSchema>

export const MailQueryFilterSchema = Type.Object(
  {
    inMailbox: Type.Optional(MailboxIdSchema),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    subject: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    hasAttachment: Type.Optional(Type.Boolean()),
    isUnread: Type.Optional(Type.Boolean()),
    isStarred: Type.Optional(Type.Boolean()),
    before: Type.Optional(IsoTimestampSchema),
    after: Type.Optional(IsoTimestampSchema),
    minSize: Type.Optional(Type.Number({ minimum: 0 })),
    maxSize: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
)
export type MailQueryFilter = Static<typeof MailQueryFilterSchema>

export const MailQueryRequestSchema = Type.Object(
  {
    accountId: AccountIdSchema,
    filter: Type.Optional(MailQueryFilterSchema),
    sort: Type.Optional(Type.Array(MailQuerySortSchema)),
    position: Type.Number({ minimum: 0 }),
    limit: Type.Number({ minimum: 1, maximum: 500 }),
    calculateTotal: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)
export type MailQueryRequest = Static<typeof MailQueryRequestSchema>

export const MailQueryResponseSchema = Type.Object(
  {
    accountId: AccountIdSchema,
    threadIds: Type.Array(ThreadIdSchema),
    messageIds: Type.Array(MessageIdSchema),
    total: Type.Number({ minimum: 0 }),
    position: Type.Number({ minimum: 0 }),
    canCalculateChanges: Type.Boolean(),
    queryState: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)
export type MailQueryResponse = Static<typeof MailQueryResponseSchema>
