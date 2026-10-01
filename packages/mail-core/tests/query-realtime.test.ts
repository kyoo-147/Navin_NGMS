import { describe, it, expect, vi } from 'vitest'
import { parseSearchQuery } from '../src/query/search-parser.js'
import { RealtimeSyncManager } from '../src/realtime/realtime-sync.js'

describe('Search Query Parser & Realtime Sync', () => {
  it('parses Gmail operators and free text into MailQueryFilter', () => {
    const raw =
      'from:alice@example.com to:bob@company.test subject:"design document" has:attachment is:unread before:2026-10-01 urgent project'
    const parsed = parseSearchQuery(raw)

    expect(parsed.filter.from).toBe('alice@example.com')
    expect(parsed.filter.to).toBe('bob@company.test')
    expect(parsed.filter.subject).toBe('design document')
    expect(parsed.filter.hasAttachment).toBe(true)
    expect(parsed.filter.isUnread).toBe(true)
    expect(parsed.filter.before).toBeDefined()
    expect(parsed.freeText).toBe('urgent project')

    expect(parsed.chips).toHaveLength(6)
    expect(parsed.chips[0]).toEqual({ key: 'from', value: 'alice@example.com' })
  })

  it('deduplicates realtime state notifications and emits events', () => {
    const manager = new RealtimeSyncManager()
    const receivedEvents: string[] = []

    manager.subscribe((event) => {
      receivedEvents.push(`${event.type}:${event.accountId}`)
    })

    // First state notification triggers event
    const changed1 = manager.handleStateNotification('acc-1', 'state-v1')
    expect(changed1).toBe(true)
    expect(receivedEvents).toHaveLength(1)
    expect(receivedEvents[0]).toBe('mailbox_updated:acc-1')

    // Duplicate notification with same state is ignored
    const changed2 = manager.handleStateNotification('acc-1', 'state-v1')
    expect(changed2).toBe(false)
    expect(receivedEvents).toHaveLength(1)

    // Advanced state triggers next event
    const changed3 = manager.handleStateNotification('acc-1', 'state-v2')
    expect(changed3).toBe(true)
    expect(receivedEvents).toHaveLength(2)
  })

  it('handles polling for registered accounts', async () => {
    vi.useFakeTimers()
    const polledAccounts: string[] = []

    const manager = new RealtimeSyncManager({
      pollIntervalMs: 5000,
      onPoll: async (accId) => {
        polledAccounts.push(accId)
      },
    })

    manager.registerAccount('acc-1')
    manager.registerAccount('acc-2')

    await vi.advanceTimersByTimeAsync(5000)
    expect(polledAccounts).toContain('acc-1')
    expect(polledAccounts).toContain('acc-2')

    manager.stopPolling()
    vi.useRealTimers()
  })
})
