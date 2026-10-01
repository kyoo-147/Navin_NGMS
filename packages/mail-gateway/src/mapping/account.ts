import type { AccountId } from '@navin/contracts'
import { readGatewayCapabilities, type GatewayCapabilities } from '../jmap/capabilities.js'
import type { JmapAccount, JmapSession } from '../jmap/types.js'
import { encodeId } from './id.js'

export interface NormalizedAccountLimits {
  maxMailboxesPerEmail: number | null
  maxMailboxDepth: number | null
  maxSizeMailboxName: number | null
  maxSizeAttachmentsPerEmail: number | null
  maxDelayedSend: number | null
  maxSizeRequest: number | null
  maxObjectsInGet: number | null
  maxObjectsInSet: number | null
}

export interface NormalizedAccount {
  accountId: AccountId
  name: string
  isPersonal: boolean
  isReadOnly: boolean
  capabilities: GatewayCapabilities
  emailQuerySortOptions: string[]
  limits: NormalizedAccountLimits
}

export function toNormalizedAccount(
  session: JmapSession,
  upstreamAccountId: string,
  account: JmapAccount,
): NormalizedAccount {
  const capabilities = readGatewayCapabilities(session, upstreamAccountId)
  return {
    accountId: encodeId('acc', upstreamAccountId) as AccountId,
    name: account.name,
    isPersonal: account.isPersonal,
    isReadOnly: account.isReadOnly,
    capabilities,
    emailQuerySortOptions: capabilities.accountMail?.emailQuerySortOptions ?? [],
    limits: {
      maxMailboxesPerEmail: capabilities.accountMail?.maxMailboxesPerEmail ?? null,
      maxMailboxDepth: capabilities.accountMail?.maxMailboxDepth ?? null,
      maxSizeMailboxName: capabilities.accountMail?.maxSizeMailboxName ?? null,
      maxSizeAttachmentsPerEmail: capabilities.accountMail?.maxSizeAttachmentsPerEmail ?? null,
      maxDelayedSend: capabilities.accountSubmission?.maxDelayedSend ?? null,
      maxSizeRequest: capabilities.core?.maxSizeRequest ?? null,
      maxObjectsInGet: capabilities.core?.maxObjectsInGet ?? null,
      maxObjectsInSet: capabilities.core?.maxObjectsInSet ?? null,
    },
  }
}
