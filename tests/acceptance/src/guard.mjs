import { isIP } from 'node:net'

export const DEFAULT_PRODUCTION_DENY = Object.freeze([
  'production.example.invalid',
  'mail.production.example.invalid',
  'webmail.production.example.invalid',
  'owner@example.invalid',
])

const RESERVED_SUFFIXES = Object.freeze([
  '.localhost',
  '.test',
  '.invalid',
  '.example',
  '.local',
  '.internal',
  '.home.arpa',
])

const RESERVED_EXACT = Object.freeze(['localhost', 'example.com', 'www.example.com'])

const LOOPBACK_EXACT = Object.freeze(['127.0.0.1', '0.0.0.0', '::1', '[::1]'])

export class GuardError extends Error {
  constructor(message, { code = 'GUARD_REJECTED', target = null, matched = null } = {}) {
    super(message)
    this.name = 'GuardError'
    this.code = code
    this.target = target
    this.matched = matched
  }
}

function stripSchemeAndPath(value) {
  return value
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '')
}

function extractHost(value) {
  const withoutUserInfo = value.includes('@') ? value.slice(value.lastIndexOf('@') + 1) : value
  const withoutPort = withoutUserInfo.replace(/:\d+$/, '')
  return withoutPort.replace(/^\[|\]$/g, '')
}

export function candidateTokens(target) {
  const raw = String(target ?? '')
    .trim()
    .toLowerCase()
  const tokens = new Set()
  if (!raw) {
    return tokens
  }
  tokens.add(raw)
  const stripped = stripSchemeAndPath(raw)
  tokens.add(stripped)
  tokens.add(extractHost(stripped))
  if (raw.includes('@')) {
    const domain = raw.slice(raw.lastIndexOf('@') + 1).replace(/:\d+$/, '')
    tokens.add(domain)
  }
  return new Set([...tokens].filter(Boolean))
}

function isReservedDocIpv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) {
    return false
  }
  const [, a, b, c] = match.map(Number)
  if (a === 192 && b === 0 && c === 2) {
    return true
  }
  if (a === 198 && b === 51 && c === 100) {
    return true
  }
  if (a === 203 && b === 0 && c === 113) {
    return true
  }
  return false
}

export function isLocalOrReserved(target) {
  for (const token of candidateTokens(target)) {
    if (LOOPBACK_EXACT.includes(token) || token.startsWith('127.')) {
      return true
    }
    if (token === '::1' || token.startsWith('2001:db8:')) {
      return true
    }
    if (RESERVED_EXACT.includes(token)) {
      return true
    }
    if (RESERVED_SUFFIXES.some((suffix) => token.endsWith(suffix))) {
      return true
    }
    if (isIP(token) === 4 && isReservedDocIpv4(token)) {
      return true
    }
  }
  return false
}

function matchesEntry(candidates, entry) {
  const normalizedEntry = String(entry).trim().toLowerCase()
  for (const candidate of candidates) {
    if (candidate === normalizedEntry) {
      return true
    }
    if (candidate.endsWith(`.${normalizedEntry}`)) {
      return true
    }
  }
  return false
}

export function createGuard({ deny = DEFAULT_PRODUCTION_DENY, allow = [] } = {}) {
  const denyList = [
    ...new Set(deny.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)),
  ]
  const allowList = [
    ...new Set(allow.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)),
  ]

  function denyMatch(target) {
    const candidates = candidateTokens(target)
    if (candidates.size === 0) {
      return null
    }
    for (const entry of denyList) {
      if (matchesEntry(candidates, entry)) {
        return entry
      }
    }
    return null
  }

  function allowMatch(target) {
    const candidates = candidateTokens(target)
    for (const entry of allowList) {
      if (matchesEntry(candidates, entry)) {
        return entry
      }
    }
    return null
  }

  function checkTarget(target) {
    if (target === undefined || target === null || String(target).trim() === '') {
      return { allowed: true, reason: 'no target declared', target: target ?? null }
    }
    const denied = denyMatch(target)
    if (denied) {
      return {
        allowed: false,
        reason: `production endpoint denied by deny-list entry "${denied}"`,
        target,
        matched: denied,
      }
    }
    const allowed = allowMatch(target)
    if (allowed) {
      return {
        allowed: true,
        reason: `explicitly allow-listed by "${allowed}"`,
        target,
        matched: allowed,
      }
    }
    if (isLocalOrReserved(target)) {
      return { allowed: true, reason: 'local or reserved disposable namespace', target }
    }
    return { allowed: false, reason: 'target not allow-listed (deny by default)', target }
  }

  function assertTarget(target) {
    const result = checkTarget(target)
    if (!result.allowed) {
      throw new GuardError(`Refusing target ${JSON.stringify(target)}: ${result.reason}`, {
        code: 'TARGET_REJECTED',
        target,
        matched: result.matched ?? null,
      })
    }
    return result
  }

  function scanForDenied(value) {
    const text = typeof value === 'string' ? value : String(value ?? '')
    const lower = text.toLowerCase()
    return denyList.filter((entry) => lower.includes(entry))
  }

  function checkText(value) {
    const found = scanForDenied(value)
    if (found.length > 0) {
      return {
        allowed: false,
        reason: `text contains denied production endpoint(s): ${found.join(', ')}`,
        matched: found,
      }
    }
    return { allowed: true, reason: 'no denied production endpoint found' }
  }

  function checkCommand(argv) {
    const args = Array.isArray(argv) ? argv : [argv]
    return checkText(args.join(' '))
  }

  function isExplicitlyAllowed(target) {
    return allowMatch(target)
  }

  return {
    checkTarget,
    assertTarget,
    scanForDenied,
    checkText,
    checkCommand,
    isExplicitlyAllowed,
    denyList,
    allowList,
  }
}

export const defaultGuard = createGuard()
