const SECRET_KEY_NAMES =
  'password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|private[_-]?key|auth[_-]?token|refresh[_-]?token|stalwart[_-]?token|smtp[_-]?password|credential'

// Quoted values are consumed through the matching closing quote (spaces, commas,
// semicolons and escaped quotes are all part of the secret). Unquoted values keep
// the conservative token behaviour and never start with a quote.
const KEY_VALUE_SECRET = new RegExp(
  String.raw`(\b(?:${SECRET_KEY_NAMES})\b["']?\s*[:=]\s*)(?:(["'])((?:\\.|(?!\2)[^\\])*)\2|(?!["'])([^\s"',;]+))`,
  'gi',
)

const RULES = Object.freeze([
  Object.freeze({
    id: 'pem-private-key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  }),
  Object.freeze({
    id: 'authorization',
    pattern: /(\bauthorization\b\s*[:=]\s*)(bearer|basic|token)\s+[^\s"',;]+/gi,
    replacement: (_match, prefix, scheme) => `${prefix}${scheme} [REDACTED:authorization]`,
  }),
  Object.freeze({
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
  }),
  Object.freeze({
    id: 'url-credentials',
    pattern: /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^\s/]+)@/gi,
    replacement: (_match, scheme, user) => `${scheme}${user}:[REDACTED:url-password]@`,
  }),
  Object.freeze({
    id: 'secret-assignment',
    pattern: KEY_VALUE_SECRET,
    replacement: (_match, prefix, quote) =>
      quote ? `${prefix}${quote}[REDACTED:secret]${quote}` : `${prefix}[REDACTED:secret]`,
  }),
])

const SENSITIVE_KEY =
  /^(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|private[_-]?key|auth[_-]?token|refresh[_-]?token|authorization|credential)s?$/i

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tally(counts, rule, count) {
  if (count > 0) {
    counts.push({ rule, count })
  }
}

export function createRedactor({ secrets = [] } = {}) {
  const literals = []
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 3) {
      continue
    }
    literals.push({
      id: 'registered-secret',
      pattern: new RegExp(escapeRegExp(secret), 'g'),
      replacement: '[REDACTED:registered-secret]',
    })
  }

  function redactText(value) {
    let text = typeof value === 'string' ? value : String(value ?? '')
    const counts = []
    for (const rule of [...literals, ...RULES]) {
      let hits = 0
      text = text.replace(rule.pattern, (...args) => {
        hits += 1
        return typeof rule.replacement === 'function'
          ? rule.replacement(...args)
          : (rule.replacement ?? `[REDACTED:${rule.id}]`)
      })
      tally(counts, rule.id, hits)
    }
    return { text, matches: counts }
  }

  function redactValue(value) {
    const counts = []
    const seen = new WeakSet()

    function walk(node, key) {
      if (typeof node === 'string') {
        if (key !== undefined && SENSITIVE_KEY.test(key)) {
          counts.push({ rule: 'sensitive-key', count: 1 })
          return '[REDACTED:sensitive-key]'
        }
        const result = redactText(node)
        for (const match of result.matches) {
          counts.push(match)
        }
        return result.text
      }
      if (node === null || typeof node !== 'object') {
        return node
      }
      if (seen.has(node)) {
        return '[REDACTED:cyclic]'
      }
      seen.add(node)
      if (Array.isArray(node)) {
        return node.map((item) => walk(item))
      }
      const output = {}
      for (const [childKey, childValue] of Object.entries(node)) {
        output[childKey] = walk(childValue, childKey)
      }
      return output
    }

    return { value: walk(value), matches: counts }
  }

  function addSecret(secret) {
    if (typeof secret !== 'string' || secret.length < 3) {
      return false
    }
    literals.push({
      id: 'registered-secret',
      pattern: new RegExp(escapeRegExp(secret), 'g'),
      replacement: '[REDACTED:registered-secret]',
    })
    return true
  }

  return { redactText, redactValue, addSecret }
}

export function summarizeRedactions(matches) {
  const summary = new Map()
  for (const match of matches ?? []) {
    summary.set(match.rule, (summary.get(match.rule) ?? 0) + match.count)
  }
  return [...summary.entries()]
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => a.rule.localeCompare(b.rule))
}

export function redactionRules() {
  return [...RULES.map((rule) => rule.id), 'registered-secret', 'sensitive-key']
}
