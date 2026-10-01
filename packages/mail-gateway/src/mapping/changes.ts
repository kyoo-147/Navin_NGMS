import type { AccountId } from '@navin/contracts'
import type { JmapChanges } from '../jmap/types.js'
import { encodeId } from './id.js'

export type ChangeKind = 'email' | 'thread' | 'mailbox'

const PREFIX_BY_KIND = {
  email: 'msg',
  thread: 'thd',
  mailbox: 'mbx',
} as const

export interface NormalizedChanges {
  accountId: AccountId
  kind: ChangeKind
  oldState: string
  newState: string
  hasMoreChanges: boolean
  created: string[]
  updated: string[]
  destroyed: string[]
}

export function toNormalizedChanges(
  changes: JmapChanges,
  accountId: string,
  kind: ChangeKind,
): NormalizedChanges {
  const prefix = PREFIX_BY_KIND[kind]
  const mapIds = (ids: string[] | null | undefined): string[] =>
    (ids ?? []).map((id) => encodeId(prefix, id))
  return {
    accountId: accountId as AccountId,
    kind,
    oldState: changes.oldState,
    newState: changes.newState,
    hasMoreChanges: changes.hasMoreChanges === true,
    created: mapIds(changes.created),
    updated: mapIds(changes.updated),
    destroyed: mapIds(changes.destroyed),
  }
}
