import type { EngineAdapterDescriptor } from '@navin/contracts'
import type {
  JmapCoreCapability,
  JmapMailAccountCapability,
  JmapSession,
  JmapSubmissionAccountCapability,
} from './types.js'
import { GatewayError } from '../errors.js'
import { isRecord } from './types.js'

export const JMAP_CORE = 'urn:ietf:params:jmap:core'
export const JMAP_MAIL = 'urn:ietf:params:jmap:mail'
export const JMAP_SUBMISSION = 'urn:ietf:params:jmap:submission'
export const JMAP_VACATION = 'urn:ietf:params:jmap:vacationresponse'
export const JMAP_CONTACTS = 'urn:ietf:params:jmap:contacts'
export const JMAP_CALENDARS = 'urn:ietf:params:jmap:calendars'

/** Navin extension used to expose engine-side scheduled-send support. */
export const SCHEDULED_SEND_CAPABILITY = 'urn:example:params:scheduled-send'

export interface GatewayCapabilities {
  /** Advertised capability URIs, verbatim from the JMAP session. */
  readonly uris: ReadonlySet<string>
  readonly core: JmapCoreCapability | null
  readonly mail: boolean
  readonly submission: boolean
  readonly vacation: boolean
  readonly contacts: boolean
  readonly calendars: boolean
  readonly scheduledSend: boolean
  readonly accountMail: JmapMailAccountCapability | null
  readonly accountSubmission: JmapSubmissionAccountCapability | null
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function readCoreCapability(session: JmapSession): JmapCoreCapability | null {
  const raw = session.capabilities[JMAP_CORE]
  if (!isRecord(raw)) return null
  return {
    maxSizeUpload: numberOr(raw.maxSizeUpload, 0),
    maxConcurrentUpload: numberOr(raw.maxConcurrentUpload, 1),
    maxSizeRequest: numberOr(raw.maxSizeRequest, 0),
    maxConcurrentRequests: numberOr(raw.maxConcurrentRequests, 1),
    maxCallsInRequest: numberOr(raw.maxCallsInRequest, 1),
    maxObjectsInGet: numberOr(raw.maxObjectsInGet, 0),
    maxObjectsInSet: numberOr(raw.maxObjectsInSet, 0),
    collationAlgorithms: Array.isArray(raw.collationAlgorithms)
      ? raw.collationAlgorithms.filter((entry): entry is string => typeof entry === 'string')
      : [],
  }
}

export function readAccountMailCapability(
  accountCapabilities: Record<string, unknown>,
): JmapMailAccountCapability | null {
  const raw = accountCapabilities[JMAP_MAIL]
  if (!isRecord(raw)) return null
  return {
    maxMailboxesPerEmail:
      typeof raw.maxMailboxesPerEmail === 'number' ? raw.maxMailboxesPerEmail : null,
    maxMailboxDepth: typeof raw.maxMailboxDepth === 'number' ? raw.maxMailboxDepth : null,
    maxSizeMailboxName: numberOr(raw.maxSizeMailboxName, 0),
    maxSizeAttachmentsPerEmail: numberOr(raw.maxSizeAttachmentsPerEmail, 0),
    emailQuerySortOptions: Array.isArray(raw.emailQuerySortOptions)
      ? raw.emailQuerySortOptions.filter((entry): entry is string => typeof entry === 'string')
      : [],
    mayCreateTopLevelMailbox: raw.mayCreateTopLevelMailbox === true,
  }
}

export function readAccountSubmissionCapability(
  accountCapabilities: Record<string, unknown>,
): JmapSubmissionAccountCapability | null {
  const raw = accountCapabilities[JMAP_SUBMISSION]
  if (!isRecord(raw)) return null
  return {
    maxDelayedSend: numberOr(raw.maxDelayedSend, 0),
    submissionExtensions: isRecord(raw.submissionExtensions)
      ? Object.fromEntries(
          Object.entries(raw.submissionExtensions).map(([key, value]) => [
            key,
            Array.isArray(value)
              ? value.filter((entry): entry is string => typeof entry === 'string')
              : [],
          ]),
        )
      : {},
  }
}

export function readGatewayCapabilities(
  session: JmapSession,
  accountUpstreamId?: string,
): GatewayCapabilities {
  const uris = new Set(Object.keys(session.capabilities))
  const account = accountUpstreamId ? session.accounts[accountUpstreamId] : undefined
  const accountCapabilities = account?.accountCapabilities ?? {}
  return {
    uris,
    core: readCoreCapability(session),
    mail: uris.has(JMAP_MAIL),
    submission: uris.has(JMAP_SUBMISSION),
    vacation: uris.has(JMAP_VACATION),
    contacts: uris.has(JMAP_CONTACTS),
    calendars: uris.has(JMAP_CALENDARS),
    scheduledSend: uris.has(SCHEDULED_SEND_CAPABILITY),
    accountMail: readAccountMailCapability(accountCapabilities),
    accountSubmission: readAccountSubmissionCapability(accountCapabilities),
  }
}

/**
 * Fails closed when a required upstream capability is not advertised.
 */
export function requireCapability(
  capabilities: GatewayCapabilities,
  uri: string,
  action: string,
): void {
  if (!capabilities.uris.has(uri)) {
    throw new GatewayError({
      code: 'ACTION_BLOCKED',
      message: `Upstream engine does not advertise required capability ${uri} for ${action}`,
      details: { capability: uri, action },
    })
  }
}

/**
 * Projects normalized JMAP capabilities into the cross-worker engine descriptor
 * contract so engine discovery can report real upstream support.
 */
export function toEngineDescriptor(
  capabilities: GatewayCapabilities,
  meta: { engineId: string; displayName: string; version: string; endpoint?: string },
): EngineAdapterDescriptor {
  const endpoint = meta.endpoint
  return {
    engineId: meta.engineId,
    displayName: meta.displayName,
    version: meta.version,
    protocols: {
      jmap: true,
      imap: false,
      pop3: false,
      smtpSubmission: capabilities.submission,
      lmtp: false,
      manageSieve: capabilities.vacation,
      caldav: capabilities.calendars,
      carddav: capabilities.contacts,
    },
    features: {
      pushNotifications: capabilities.core !== null,
      serverSideSearch: capabilities.mail,
      fullTextIndexing: capabilities.mail,
      storageQuota: false,
      aliases: capabilities.submission,
      distributionGroups: false,
      dkimSigning: false,
      tlsEnforcement: endpoint?.startsWith('https://') ?? false,
      adminApi: false,
    },
    ...(endpoint
      ? {
          connection: {
            endpoint,
            secure: endpoint.startsWith('https://'),
            authMethods: ['basic', 'bearer'],
          },
        }
      : {}),
  }
}
