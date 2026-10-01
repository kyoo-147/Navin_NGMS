import type { AccountId } from '@navin/contracts'
import {
  JMAP_MAIL,
  JMAP_SUBMISSION,
  readGatewayCapabilities,
  type GatewayCapabilities,
} from '../jmap/capabilities.js'
import type { JmapAccount, JmapSession } from '../jmap/types.js'
import { encodeId } from './id.js'

export interface NormalizedAccountSummary {
  accountId: AccountId
  name: string
  isPersonal: boolean
  isReadOnly: boolean
  mailCapable: boolean
  submissionCapable: boolean
}

export interface NormalizedSession {
  username: string
  state: string
  capabilities: GatewayCapabilities
  accounts: NormalizedAccountSummary[]
  primaryAccountId: AccountId | null
}

function hasAccountCapability(account: JmapAccount, uri: string): boolean {
  return uri in account.accountCapabilities
}

export function toNormalizedSession(session: JmapSession): NormalizedSession {
  const accounts = Object.entries(session.accounts).map(([upstreamId, account]) => ({
    accountId: encodeId('acc', upstreamId) as AccountId,
    name: account.name,
    isPersonal: account.isPersonal,
    isReadOnly: account.isReadOnly,
    mailCapable: hasAccountCapability(account, JMAP_MAIL),
    submissionCapable: hasAccountCapability(account, JMAP_SUBMISSION),
  }))

  const primaryUpstream = session.primaryAccounts[JMAP_MAIL]
  return {
    username: session.username,
    state: session.state,
    capabilities: readGatewayCapabilities(session),
    accounts,
    primaryAccountId: primaryUpstream ? (encodeId('acc', primaryUpstream) as AccountId) : null,
  }
}
