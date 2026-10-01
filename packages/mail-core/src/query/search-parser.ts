import type { MailQueryFilter } from '@navin/contracts'

export interface ParsedSearchQuery {
  filter: MailQueryFilter
  freeText: string
  chips: Array<{ key: string; value: string }>
}

/**
 * Parses a Gmail-familiar search query string into a normalized MailQueryFilter
 * and a list of structured search chips.
 *
 * Supported operators:
 * - from:alice@example.com
 * - to:bob@company.test
 * - subject:"quarterly report"
 * - has:attachment
 * - is:unread / is:read
 * - is:starred
 * - in:inbox / in:sent / in:trash / in:spam
 * - before:YYYY-MM-DD
 * - after:YYYY-MM-DD
 * - free text words
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const filter: MailQueryFilter = {}
  const chips: Array<{ key: string; value: string }> = []
  const textWords: string[] = []

  // Tokenize preserving quoted phrases
  const regex = /(?:(\w+):(?:"([^"]*)"|([^\s]+)))|(?:"([^"]*)")|([^\s]+)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(query)) !== null) {
    const operator = match[1]?.toLowerCase()
    const opQuotedVal = match[2]
    const opUnquotedVal = match[3]
    const opVal = opQuotedVal ?? opUnquotedVal

    const quotedText = match[4]
    const plainText = match[5]

    if (operator && opVal !== undefined) {
      chips.push({ key: operator, value: opVal })

      switch (operator) {
        case 'from':
          filter.from = opVal
          break
        case 'to':
          filter.to = opVal
          break
        case 'subject':
          filter.subject = opVal
          break
        case 'has':
          if (opVal.toLowerCase() === 'attachment') {
            filter.hasAttachment = true
          }
          break
        case 'is':
          if (opVal.toLowerCase() === 'unread') {
            filter.isUnread = true
          } else if (opVal.toLowerCase() === 'read') {
            filter.isUnread = false
          } else if (opVal.toLowerCase() === 'starred') {
            filter.isStarred = true
          }
          break
        case 'in':
          // Mailbox role indicator (inbox, sent, trash, spam)
          // The caller or client can map this role to a specific mailbox ID
          ;(filter as Record<string, unknown>)._role = opVal.toLowerCase()
          break
        case 'before':
          filter.before = new Date(opVal).toISOString()
          break
        case 'after':
          filter.after = new Date(opVal).toISOString()
          break
        default:
          textWords.push(`${operator}:${opVal}`)
          break
      }
    } else if (quotedText !== undefined) {
      textWords.push(quotedText)
    } else if (plainText !== undefined) {
      textWords.push(plainText)
    }
  }

  const freeText = textWords.join(' ').trim()
  if (freeText) {
    filter.text = freeText
  }

  return { filter, freeText, chips }
}
