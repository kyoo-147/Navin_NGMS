import { EngineError, type EngineErrorCategory } from '../errors.js'
import type { EngineAliasRecord, EngineDomainRecord, EngineMailboxRecord } from '../resources.js'
import type { JmapErrorSource, StalwartAccount, StalwartAlias, StalwartDomain } from './wire.js'

const DOMAIN_FIELDS = ['name', 'description', 'dkimSigning', 'catchAll'] as const
const MAILBOX_FIELDS = ['name', 'domainId', 'description', 'quotaBytes'] as const
const ALIAS_FIELDS = ['name', 'domainId', 'target', 'enabled', 'description'] as const

export function pickDefined(
  source: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!source) return out
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

export function toDomainRecord(raw: StalwartDomain): EngineDomainRecord {
  const record: EngineDomainRecord = { id: raw.id, name: raw.name }
  if (raw.description !== undefined) record.description = raw.description
  if (raw.dkimSigning !== undefined) record.dkimSigning = raw.dkimSigning
  if (raw.catchAll !== undefined) record.catchAll = raw.catchAll
  return record
}

export function toMailboxRecord(raw: StalwartAccount, domainName: string): EngineMailboxRecord {
  const record: EngineMailboxRecord = {
    id: raw.id,
    name: raw.name,
    email: `${raw.name}@${domainName}`,
    domainId: raw.domainId,
  }
  if (raw.description !== undefined) record.description = raw.description
  if (raw.quotaBytes !== undefined) record.quotaBytes = raw.quotaBytes
  return record
}

export function toAliasRecord(raw: StalwartAlias, domainName: string): EngineAliasRecord {
  const record: EngineAliasRecord = {
    id: raw.id,
    name: raw.name,
    address: `${raw.name}@${domainName}`,
    domainId: raw.domainId,
    target: raw.target,
    enabled: raw.enabled ?? true,
  }
  if (raw.description !== undefined) record.description = raw.description
  return record
}

export function domainRecordToManaged(record: EngineDomainRecord): Record<string, unknown> {
  return pickDefined(record as unknown as Record<string, unknown>, DOMAIN_FIELDS)
}

export function mailboxRecordToManaged(record: EngineMailboxRecord): Record<string, unknown> {
  return pickDefined(record as unknown as Record<string, unknown>, MAILBOX_FIELDS)
}

export function aliasRecordToManaged(record: EngineAliasRecord): Record<string, unknown> {
  return pickDefined(record as unknown as Record<string, unknown>, ALIAS_FIELDS)
}

export function stalwartDomainToManaged(raw: StalwartDomain): Record<string, unknown> {
  return pickDefined(raw as unknown as Record<string, unknown>, DOMAIN_FIELDS)
}

export function stalwartAccountToManaged(raw: StalwartAccount): Record<string, unknown> {
  return pickDefined(raw as unknown as Record<string, unknown>, MAILBOX_FIELDS)
}

export function stalwartAliasToManaged(raw: StalwartAlias): Record<string, unknown> {
  return pickDefined(raw as unknown as Record<string, unknown>, ALIAS_FIELDS)
}

const JMAP_TYPE_CATEGORY: Record<string, EngineErrorCategory> = {
  notFound: 'not_found',
  invalidArguments: 'validation',
  invalidProperties: 'validation',
  forbidden: 'forbidden',
  accountNotFound: 'not_found',
  accountReadOnly: 'forbidden',
  serverUnavailable: 'unavailable',
  serverFail: 'internal',
  serverPartialFail: 'internal',
  unknownMethod: 'protocol',
  invalidResultReference: 'protocol',
  stateMismatch: 'conflict',
  overQuota: 'conflict',
  tooLarge: 'validation',
  requestTooLarge: 'validation',
  rateLimit: 'rate_limited',
  cannotCalculateChanges: 'conflict',
}

export function jmapError(source: JmapErrorSource | undefined, fallback: string): EngineError {
  const type = source?.type ?? 'serverFail'
  const category = JMAP_TYPE_CATEGORY[type] ?? 'protocol'
  return new EngineError({
    category,
    message: source?.description ?? `${fallback}: ${type}`,
    status: source?.status,
    details: { jmapType: type },
  })
}
