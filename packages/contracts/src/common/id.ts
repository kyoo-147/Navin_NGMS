import { Type, type Static, type TString } from '@sinclair/typebox'

declare const __brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [__brand]: B }

export const IdSchema = Type.String({
  minLength: 1,
  pattern: '^\\S+$',
  description: 'Generic non-empty identifier',
})
export type Id = Brand<Static<typeof IdSchema>, 'Id'>

export function createPrefixedIdSchema(prefix: string, description: string): TString {
  return Type.String({
    pattern: `^${prefix}_[a-zA-Z0-9._-]+$`,
    minLength: prefix.length + 2,
    maxLength: 128,
    description,
  })
}

export const AccountIdSchema = createPrefixedIdSchema('acc', 'Account ID')
export type AccountId = Brand<Static<typeof AccountIdSchema>, 'AccountId'>

export const UserIdSchema = createPrefixedIdSchema('usr', 'User ID')
export type UserId = Brand<Static<typeof UserIdSchema>, 'UserId'>

export const DomainIdSchema = createPrefixedIdSchema('dom', 'Domain ID')
export type DomainId = Brand<Static<typeof DomainIdSchema>, 'DomainId'>

export const MailboxIdSchema = createPrefixedIdSchema('mbx', 'Mailbox ID')
export type MailboxId = Brand<Static<typeof MailboxIdSchema>, 'MailboxId'>

export const AliasIdSchema = createPrefixedIdSchema('als', 'Alias ID')
export type AliasId = Brand<Static<typeof AliasIdSchema>, 'AliasId'>

export const GroupIdSchema = createPrefixedIdSchema('grp', 'Group ID')
export type GroupId = Brand<Static<typeof GroupIdSchema>, 'GroupId'>

export const SetupSessionIdSchema = createPrefixedIdSchema('set', 'Setup Session ID')
export type SetupSessionId = Brand<Static<typeof SetupSessionIdSchema>, 'SetupSessionId'>

export const SetupBlockIdSchema = createPrefixedIdSchema('blk', 'Setup Block ID')
export type SetupBlockId = Brand<Static<typeof SetupBlockIdSchema>, 'SetupBlockId'>

export const ActionIdSchema = createPrefixedIdSchema('act', 'Action ID')
export type ActionId = Brand<Static<typeof ActionIdSchema>, 'ActionId'>

export const PlanIdSchema = createPrefixedIdSchema('pln', 'Plan ID')
export type PlanId = Brand<Static<typeof PlanIdSchema>, 'PlanId'>

export const ApprovalIdSchema = createPrefixedIdSchema('app', 'Approval ID')
export type ApprovalId = Brand<Static<typeof ApprovalIdSchema>, 'ApprovalId'>

export const JobIdSchema = createPrefixedIdSchema('job', 'Job ID')
export type JobId = Brand<Static<typeof JobIdSchema>, 'JobId'>

export const EventIdSchema = createPrefixedIdSchema('evt', 'Event ID')
export type EventId = Brand<Static<typeof EventIdSchema>, 'EventId'>

export const AuditIdSchema = createPrefixedIdSchema('aud', 'Audit ID')
export type AuditId = Brand<Static<typeof AuditIdSchema>, 'AuditId'>

export const EvidenceIdSchema = createPrefixedIdSchema('evi', 'Evidence ID')
export type EvidenceId = Brand<Static<typeof EvidenceIdSchema>, 'EvidenceId'>

export const MessageIdSchema = createPrefixedIdSchema('msg', 'Message ID')
export type MessageId = Brand<Static<typeof MessageIdSchema>, 'MessageId'>

export const ThreadIdSchema = createPrefixedIdSchema('thd', 'Thread ID')
export type ThreadId = Brand<Static<typeof ThreadIdSchema>, 'ThreadId'>

export const FolderIdSchema = createPrefixedIdSchema('fld', 'Folder ID')
export type FolderId = Brand<Static<typeof FolderIdSchema>, 'FolderId'>

export const DraftIdSchema = createPrefixedIdSchema('dft', 'Draft ID')
export type DraftId = Brand<Static<typeof DraftIdSchema>, 'DraftId'>

export const ProviderIdSchema = createPrefixedIdSchema('prv', 'Provider ID')
export type ProviderId = Brand<Static<typeof ProviderIdSchema>, 'ProviderId'>

export const ExtensionIdSchema = createPrefixedIdSchema('ext', 'Extension ID')
export type ExtensionId = Brand<Static<typeof ExtensionIdSchema>, 'ExtensionId'>

export const IdempotencyKeySchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: '^[a-zA-Z0-9._-]+$',
  description: 'Idempotency key for mutations and submissions',
})
export type IdempotencyKey = Brand<Static<typeof IdempotencyKeySchema>, 'IdempotencyKey'>
