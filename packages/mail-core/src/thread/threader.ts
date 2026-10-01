import type { MailboxId, MessageId, ThreadId } from '@navin/contracts'
import type { NormalizedEmail } from '@navin/mail-gateway'

export interface Participant {
  name?: string
  address: string
}

export interface ThreadSummary {
  id: ThreadId
  subject: string
  messages: NormalizedEmail[]
  messageCount: number
  unreadCount: number
  isStarred: boolean
  hasAttachment: boolean
  participants: Participant[]
  latestReceivedAt: string
  snippet: string
  mailboxIds: MailboxId[]
}

/**
 * Groups normalized emails into threads, sorts messages in chronological order,
 * aggregates thread metadata (participants, unread count, star, attachments),
 * and orders threads descending by latest received timestamp.
 */
export function groupEmailsIntoThreads(emails: readonly NormalizedEmail[]): ThreadSummary[] {
  const threadMap = new Map<ThreadId, NormalizedEmail[]>()

  for (const email of emails) {
    const list = threadMap.get(email.threadId)
    if (list) {
      list.push(email)
    } else {
      threadMap.set(email.threadId, [email])
    }
  }

  const summaries: ThreadSummary[] = []

  for (const [threadId, rawMessages] of threadMap.entries()) {
    // Sort messages in thread chronologically (oldest to newest)
    const messages = [...rawMessages].sort(
      (a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
    )

    const newestMessage = messages[messages.length - 1]!
    const oldestMessage = messages[0]!

    // Deduplicate participants preserving first appearance
    const seenAddresses = new Set<string>()
    const participants: Participant[] = []

    for (const msg of messages) {
      for (const sender of msg.from) {
        if (!seenAddresses.has(sender.address.toLowerCase())) {
          seenAddresses.add(sender.address.toLowerCase())
          participants.push(sender)
        }
      }
    }

    const unreadCount = messages.filter((m) => m.isUnread).length
    const isStarred = messages.some((m) => m.isStarred)
    const hasAttachment = messages.some((m) => m.hasAttachment)

    // Aggregate all unique mailbox IDs
    const mailboxIdSet = new Set<MailboxId>()
    for (const msg of messages) {
      for (const mbId of msg.mailboxIds) {
        mailboxIdSet.add(mbId)
      }
    }

    summaries.push({
      id: threadId,
      subject: oldestMessage.subject || '(no subject)',
      messages,
      messageCount: messages.length,
      unreadCount,
      isStarred,
      hasAttachment,
      participants,
      latestReceivedAt: newestMessage.receivedAt,
      snippet: newestMessage.preview || (newestMessage.bodyText ?? '').slice(0, 120),
      mailboxIds: Array.from(mailboxIdSet),
    })
  }

  // Sort threads descending by newest received date
  return summaries.sort(
    (a, b) => new Date(b.latestReceivedAt).getTime() - new Date(a.latestReceivedAt).getTime(),
  )
}

/**
 * Finds a thread summary by thread ID.
 */
export function findThreadById(
  threads: readonly ThreadSummary[],
  threadId: string,
): ThreadSummary | undefined {
  return threads.find((t) => t.id === threadId)
}

/**
 * Finds a specific email by message ID within a thread list.
 */
export function findMessageInThreads(
  threads: readonly ThreadSummary[],
  messageId: MessageId,
): NormalizedEmail | undefined {
  for (const t of threads) {
    const found = t.messages.find((m) => m.id === messageId)
    if (found) return found
  }
  return undefined
}
