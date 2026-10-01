import { describe, it, expect } from 'vitest'
import {
  evaluateServerCapabilities,
  getCapabilityNotices,
} from '../src/capabilities/capabilities.js'

describe('Server Capabilities & Unsupported Features', () => {
  it('evaluates raw JMAP session capabilities and produces explicit notices', () => {
    // Basic JMAP server without scheduled send or sieve
    const basicCaps = evaluateServerCapabilities({
      'urn:ietf:params:jmap:core': {},
      'urn:ietf:params:jmap:mail': {},
    })
    expect(basicCaps.scheduledSend).toBe(false)
    expect(basicCaps.serverFilters).toBe(false)
    expect(basicCaps.snooze).toBe(false)

    const notices = getCapabilityNotices(basicCaps)
    expect(notices).toHaveLength(4)

    const schedNotice = notices.find((n) => n.capability === 'scheduledSend')
    expect(schedNotice?.supported).toBe(false)
    expect(schedNotice?.fallbackAvailable).toBe(true)
    expect(schedNotice?.description).toContain('client outbox')

    const snoozeNotice = notices.find((n) => n.capability === 'snooze')
    expect(snoozeNotice?.supported).toBe(false)
    expect(snoozeNotice?.fallbackAvailable).toBe(false)

    // Full featured server
    const advancedCaps = evaluateServerCapabilities({
      'urn:ietf:params:jmap:core': {},
      'urn:ietf:params:jmap:mail': {},
      'urn:ietf:params:jmap:submission': {},
      'https://stalw.art/jmap/submission/schedule': {},
      'urn:ietf:params:jmap:sieve': {},
      'urn:ietf:params:jmap:vacationresponse': {},
    })
    expect(advancedCaps.scheduledSend).toBe(true)
    expect(advancedCaps.serverFilters).toBe(true)
    expect(advancedCaps.vacationResponder).toBe(true)
  })
})
