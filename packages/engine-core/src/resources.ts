import { EngineError } from './errors.js'

export type EngineResourceKind = 'domain' | 'mailbox' | 'alias'

export interface DomainSpec {
  name: string
  description?: string
  dkimSigning?: boolean
  catchAll?: string | null
}

export interface MailboxSpec {
  email: string
  displayName?: string
  description?: string
  password?: string
  quotaBytes?: number
}

export interface AliasSpec {
  address: string
  target: string
  enabled?: boolean
  description?: string
}

export interface EngineDomainRecord {
  id: string
  name: string
  description?: string
  dkimSigning?: boolean
  catchAll?: string | null
}

export interface EngineMailboxRecord {
  id: string
  name: string
  email: string
  domainId: string
  description?: string
  quotaBytes?: number
}

export interface EngineAliasRecord {
  id: string
  name: string
  address: string
  domainId: string
  target: string
  enabled: boolean
  description?: string
}

export interface ParsedAddress {
  localPart: string
  domain: string
  address: string
}

export function normalizeDomainName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\.$/, '')
  if (normalized.length === 0) {
    throw new EngineError({ category: 'validation', message: 'Domain name must not be empty' })
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(normalized)) {
    throw new EngineError({
      category: 'validation',
      message: `Invalid domain name: ${name}`,
      details: { domain: name },
    })
  }
  return normalized
}

export function parseEmailAddress(address: string): ParsedAddress {
  const trimmed = address.trim().toLowerCase()
  const at = trimmed.indexOf('@')
  if (at <= 0 || at !== trimmed.lastIndexOf('@') || at === trimmed.length - 1) {
    throw new EngineError({
      category: 'validation',
      message: `Invalid email address: ${address}`,
      details: { address },
    })
  }
  const localPart = trimmed.slice(0, at)
  const domain = normalizeDomainName(trimmed.slice(at + 1))
  if (/\s/.test(localPart)) {
    throw new EngineError({
      category: 'validation',
      message: `Invalid email local part: ${address}`,
      details: { address },
    })
  }
  return { localPart, domain, address: `${localPart}@${domain}` }
}

export function domainSpecToDesired(spec: DomainSpec): Record<string, unknown> {
  const desired: Record<string, unknown> = { name: normalizeDomainName(spec.name) }
  if (spec.description !== undefined) desired.description = spec.description
  if (spec.dkimSigning !== undefined) desired.dkimSigning = spec.dkimSigning
  if (spec.catchAll !== undefined) desired.catchAll = spec.catchAll
  return desired
}

export function mailboxSpecToDesired(spec: MailboxSpec, domainId: string): Record<string, unknown> {
  const parsed = parseEmailAddress(spec.email)
  const desired: Record<string, unknown> = {
    name: parsed.localPart,
    domainId,
  }
  if (spec.displayName !== undefined) desired.description = spec.displayName
  else if (spec.description !== undefined) desired.description = spec.description
  if (spec.quotaBytes !== undefined) desired.quotaBytes = spec.quotaBytes
  return desired
}

export function aliasSpecToDesired(spec: AliasSpec, domainId: string): Record<string, unknown> {
  const parsed = parseEmailAddress(spec.address)
  const target = parseEmailAddress(spec.target)
  const desired: Record<string, unknown> = {
    name: parsed.localPart,
    domainId,
    target: target.address,
    enabled: spec.enabled ?? true,
  }
  if (spec.description !== undefined) desired.description = spec.description
  return desired
}
