export interface ServerCapabilities {
  scheduledSend: boolean
  snooze: boolean
  serverFilters: boolean
  vacationResponder: boolean
  organizationDirectory: boolean
}

export interface CapabilityNotice {
  capability: keyof ServerCapabilities
  supported: boolean
  title: string
  description: string
  fallbackAvailable: boolean
}

/**
 * Inspects server capabilities (e.g. from JMAP session or configuration)
 * and determines supported/unsupported features.
 */
export function evaluateServerCapabilities(
  rawCapabilities: Record<string, unknown> = {},
): ServerCapabilities {
  const hasSubmission = Boolean(rawCapabilities['urn:ietf:params:jmap:submission'])
  const hasScheduled = Boolean(
    rawCapabilities['https://stalw.art/jmap/submission/schedule'] ||
    rawCapabilities['urn:ietf:params:jmap:submission:schedule'],
  )
  const hasFilters = Boolean(rawCapabilities['urn:ietf:params:jmap:sieve'])
  const hasVacation = Boolean(rawCapabilities['urn:ietf:params:jmap:vacationresponse'])

  return {
    scheduledSend: hasSubmission && hasScheduled,
    snooze: false, // Phase 1 baseline Stalwart does not have native JMAP snooze
    serverFilters: hasFilters,
    vacationResponder: hasVacation,
    organizationDirectory: false, // Phase 1 baseline directory read path optional
  }
}

/**
 * Returns human-readable notices explaining which features are supported or unsupported.
 */
export function getCapabilityNotices(caps: ServerCapabilities): CapabilityNotice[] {
  return [
    {
      capability: 'scheduledSend',
      supported: caps.scheduledSend,
      title: 'Scheduled Send',
      description: caps.scheduledSend
        ? 'Server will deliver email at the scheduled timestamp.'
        : 'Server lacks native scheduled send; email will be held in the client outbox until scheduled time.',
      fallbackAvailable: true,
    },
    {
      capability: 'snooze',
      supported: caps.snooze,
      title: 'Snooze Emails',
      description: caps.snooze
        ? 'Snoozed emails will automatically return to the Inbox.'
        : 'Server does not support delayed mailbox return. Snoozed items remain in the Snoozed folder.',
      fallbackAvailable: false,
    },
    {
      capability: 'serverFilters',
      supported: caps.serverFilters,
      title: 'Server-Side Rules',
      description: caps.serverFilters
        ? 'Filters run automatically on the server.'
        : 'Server-side Sieve rules are not enabled on this engine.',
      fallbackAvailable: false,
    },
    {
      capability: 'vacationResponder',
      supported: caps.vacationResponder,
      title: 'Vacation Responder',
      description: caps.vacationResponder
        ? 'Server automatically replies with out-of-office message.'
        : 'Server vacation auto-reply capability is not detected.',
      fallbackAvailable: false,
    },
  ]
}
