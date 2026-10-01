import type {
  MailQueryFilter,
  MailQueryResponse,
  MailQuerySort,
  MailQuerySortField,
  MessageId,
  ThreadId,
} from '@navin/contracts'
import { GatewayError } from '../errors.js'
import type { JmapEmail, JmapQueryResult } from '../jmap/types.js'
import { encodeId, upstreamId } from './id.js'

const SORT_PROPERTY: Record<MailQuerySortField, string> = {
  date: 'receivedAt',
  from: 'from',
  subject: 'subject',
  size: 'size',
}

export interface JmapEmailQuerySort {
  property: string
  isAscending: boolean
}

/**
 * Maps the normalized mail filter onto a JMAP Email/query filter, combining
 * conditions with an explicit AND operator so behaviour is unambiguous.
 */
export function buildEmailQueryFilter(
  filter?: MailQueryFilter,
): Record<string, unknown> | undefined {
  if (!filter) return undefined
  const conditions: Record<string, unknown>[] = []

  if (filter.inMailbox) conditions.push({ inMailbox: upstreamId(filter.inMailbox) })
  if (filter.from) conditions.push({ from: filter.from })
  if (filter.to) conditions.push({ to: filter.to })
  if (filter.subject) conditions.push({ subject: filter.subject })
  if (filter.text) conditions.push({ text: filter.text })
  if (filter.hasAttachment !== undefined) conditions.push({ hasAttachment: filter.hasAttachment })
  if (filter.isUnread !== undefined) {
    conditions.push(filter.isUnread ? { notKeyword: '$seen' } : { hasKeyword: '$seen' })
  }
  if (filter.isStarred !== undefined) {
    conditions.push(filter.isStarred ? { hasKeyword: '$flagged' } : { notKeyword: '$flagged' })
  }
  if (filter.before) conditions.push({ before: filter.before })
  if (filter.after) conditions.push({ after: filter.after })
  if (filter.minSize !== undefined) conditions.push({ minSize: filter.minSize })
  if (filter.maxSize !== undefined) conditions.push({ maxSize: filter.maxSize })

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return { operator: 'AND', conditions }
}

export function buildEmailQuerySort(
  sort: MailQuerySort[] | undefined,
  allowedProperties?: readonly string[],
): JmapEmailQuerySort[] {
  const out: JmapEmailQuerySort[] = []
  for (const entry of sort ?? []) {
    const property = SORT_PROPERTY[entry.field]
    if (
      allowedProperties &&
      allowedProperties.length > 0 &&
      !allowedProperties.includes(property)
    ) {
      throw new GatewayError({
        code: 'VALIDATION_FAILED',
        message: `Upstream engine does not support sorting mail by ${entry.field}`,
        details: { field: entry.field, property },
      })
    }
    out.push({ property, isAscending: entry.direction === 'asc' })
  }
  if (out.length === 0) out.push({ property: 'receivedAt', isAscending: false })
  return out
}

export function toMailQueryResponse(input: {
  accountId: string
  result: JmapQueryResult
  emails: readonly JmapEmail[]
}): MailQueryResponse {
  const messageIds = input.result.ids.map((id) => encodeId('msg', id) as MessageId)
  const threadIds: ThreadId[] = []
  const seen = new Set<string>()
  for (const email of input.emails) {
    const threadId = encodeId('thd', email.threadId)
    if (!seen.has(threadId)) {
      seen.add(threadId)
      threadIds.push(threadId as ThreadId)
    }
  }
  return {
    accountId: input.accountId,
    threadIds,
    messageIds,
    total: typeof input.result.total === 'number' ? input.result.total : input.result.ids.length,
    position: input.result.position,
    canCalculateChanges: input.result.canCalculateChanges === true,
    queryState: input.result.queryState,
  }
}
