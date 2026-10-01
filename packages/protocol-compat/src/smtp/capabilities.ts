/** Parsed SMTP EHLO keyword set with convenience predicates (case-insensitive). */
export class SmtpCapabilities {
  readonly tokens: readonly string[]
  private readonly parametersByKeyword: ReadonlyMap<string, readonly string[]>
  readonly authMechanisms: readonly string[]

  constructor(ehloLines: readonly string[]) {
    const tokens: string[] = []
    const parameters = new Map<string, string[]>()
    const auth: string[] = []

    // The first EHLO line is the server greeting/domain, not a keyword.
    for (const line of ehloLines.slice(1)) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const [keyword, ...rest] = trimmed.split(/\s+/)
      if (keyword === undefined) continue
      const upper = keyword.toUpperCase()
      tokens.push(upper)
      parameters.set(upper, rest)
      if (upper === 'AUTH') {
        for (const mechanism of rest) auth.push(mechanism.toUpperCase())
      }
    }

    this.tokens = tokens
    this.parametersByKeyword = parameters
    this.authMechanisms = auth
  }

  has(keyword: string): boolean {
    return this.parametersByKeyword.has(keyword.toUpperCase())
  }

  parameters(keyword: string): readonly string[] {
    return this.parametersByKeyword.get(keyword.toUpperCase()) ?? []
  }

  supportsAuth(mechanism: string): boolean {
    return this.authMechanisms.includes(mechanism.toUpperCase())
  }

  get startTls(): boolean {
    return this.has('STARTTLS')
  }

  get pipelining(): boolean {
    return this.has('PIPELINING')
  }

  get eightBitMime(): boolean {
    return this.has('8BITMIME')
  }

  get sizeLimit(): number | undefined {
    const params = this.parameters('SIZE')
    const value = params[0]
    if (value === undefined) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
}

export function emptySmtpCapabilities(): SmtpCapabilities {
  return new SmtpCapabilities([])
}

export function parseSmtpCapabilities(ehloLines: readonly string[]): SmtpCapabilities {
  return new SmtpCapabilities(ehloLines)
}
