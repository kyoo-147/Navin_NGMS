import type { ImapResponse } from './parser.js'

const CAPABILITY_BRACKET = /\[CAPABILITY ([^\]]*)\]/i

/** Parsed IMAP CAPABILITY set with convenience predicates (case-insensitive). */
export class ImapCapabilities {
  readonly tokens: readonly string[]
  private readonly upper: ReadonlySet<string>
  readonly authMechanisms: readonly string[]

  constructor(tokens: Iterable<string>) {
    const normalized: string[] = []
    const seen = new Set<string>()
    const auth: string[] = []
    for (const raw of tokens) {
      const token = raw.trim()
      if (token === '') continue
      const upper = token.toUpperCase()
      if (!seen.has(upper)) {
        seen.add(upper)
        normalized.push(upper)
      }
      if (upper.startsWith('AUTH=')) auth.push(upper.slice('AUTH='.length))
    }
    this.tokens = normalized
    this.upper = seen
    this.authMechanisms = auth
  }

  has(token: string): boolean {
    return this.upper.has(token.toUpperCase())
  }

  supportsAuth(mechanism: string): boolean {
    return this.upper.has(`AUTH=${mechanism.toUpperCase()}`)
  }

  get startTls(): boolean {
    return this.upper.has('STARTTLS')
  }

  get loginDisabled(): boolean {
    return this.upper.has('LOGINDISABLED')
  }
}

export function emptyImapCapabilities(): ImapCapabilities {
  return new ImapCapabilities([])
}

export function parseImapCapabilities(tokens: Iterable<string>): ImapCapabilities {
  return new ImapCapabilities(tokens)
}

/** Extracts capabilities from `* CAPABILITY ...` and `* OK [CAPABILITY ...]` responses. */
export function collectImapCapabilities(responses: Iterable<ImapResponse>): ImapCapabilities {
  const tokens: string[] = []
  for (const response of responses) {
    if (response.untagged === 'CAPABILITY') {
      for (const token of response.rest.split(/\s+/)) tokens.push(token)
      continue
    }
    if (response.untagged === 'OK' || response.status === 'OK') {
      const match = CAPABILITY_BRACKET.exec(response.rest)
      if (match !== null && match[1] !== undefined) {
        for (const token of match[1].split(/\s+/)) tokens.push(token)
      }
    }
  }
  return new ImapCapabilities(tokens)
}
