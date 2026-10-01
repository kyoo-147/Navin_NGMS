import type { MailMessage } from '@navin/api-client'

export interface ThreadGroup {
  id: string
  subject: string
  messages: MailMessage[]
  messageCount: number
  unreadCount: number
  isStarred: boolean
  hasAttachment: boolean
  latestReceivedAt: string
  snippet: string
  participants: string
}

/**
 * Groups normalized messages into threads client-side. Kept local to the Web
 * app so the browser bundle never pulls the Node-oriented mail-core/mail-ui
 * module graph.
 */
export function groupEmailsIntoThreads(messages: readonly MailMessage[]): ThreadGroup[] {
  const byThread = new Map<string, MailMessage[]>()
  for (const message of messages) {
    const list = byThread.get(message.threadId)
    if (list) list.push(message)
    else byThread.set(message.threadId, [message])
  }

  const groups: ThreadGroup[] = []
  for (const [id, raw] of byThread) {
    const ordered = [...raw].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    const newest = ordered[ordered.length - 1]!
    const oldest = ordered[0]!
    const participants = [
      ...new Set(
        ordered.flatMap((message) => message.from.map((from) => from.name ?? from.address)),
      ),
    ].join(', ')
    groups.push({
      id,
      subject: oldest.subject || '(no subject)',
      messages: ordered,
      messageCount: ordered.length,
      unreadCount: ordered.filter((message) => message.isUnread).length,
      isStarred: ordered.some((message) => message.isStarred),
      hasAttachment: ordered.some((message) => message.hasAttachment),
      latestReceivedAt: newest.receivedAt,
      snippet: newest.preview || (newest.bodyText ?? '').slice(0, 120),
      participants,
    })
  }
  return groups.sort((a, b) => Date.parse(b.latestReceivedAt) - Date.parse(a.latestReceivedAt))
}

/** Minimal, safe HTML→text conversion for messages that only have an HTML body. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseRecipients(value: string): { address: string }[] {
  return value
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry))
    .map((address) => ({ address }))
}
