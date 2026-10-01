import { assertNoWireControlBytes } from '../common/wire.js'
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls'
import { ProtocolError } from '../common/errors.js'
import { resolveLimits, type ProtocolLimits } from '../common/limits.js'
import type { SaslCredentials } from '../common/sasl.js'
import type { OperationOptions } from '../common/timeout.js'
import { BoundedConnection } from '../transport/connection.js'
import type { TlsMode } from '../transport/types.js'
import { imapContinuationResponse, imapInitialResponse, isImapAuthMechanism } from './auth.js'
import { collectImapCapabilities, emptyImapCapabilities, ImapCapabilities } from './capabilities.js'
import { readImapResponse, type ImapResponse } from './parser.js'

export interface ImapClientOptions {
  host: string
  port: number
  /** Defaults to `none`. Use `implicit` for port 993 or `starttls` for 143. */
  tls?: TlsMode
  tlsOptions?: TlsConnectionOptions
  limits?: Partial<ProtocolLimits>
  signal?: AbortSignal
  connectTimeoutMs?: number
  /** Test-only escape hatch; production callers must establish TLS first. */
  unsafeAllowInsecureAuthForTests?: boolean
}

export type ImapState = 'not_authenticated' | 'authenticated' | 'logout'

export interface ImapCommandResult {
  tag: string
  status: 'OK' | 'NO' | 'BAD'
  text: string
  untagged: ImapResponse[]
  raw: Buffer
}

/**
 * A bounded IMAP4rev1 client. It correlates tagged commands with untagged
 * responses, resolves literals incrementally, gates STARTTLS on the advertised
 * capability and exposes SASL authentication abstractions.
 */
export class ImapClient {
  private readonly connection: BoundedConnection
  private readonly limits: ProtocolLimits
  private readonly tlsOptions: TlsConnectionOptions
  private readonly unsafeAllowInsecureAuthForTests: boolean
  private counter = 0
  private stateValue: ImapState = 'not_authenticated'
  private capabilitiesValue: ImapCapabilities = emptyImapCapabilities()
  private greetingValue: ImapResponse | null = null

  private constructor(
    connection: BoundedConnection,
    limits: ProtocolLimits,
    tlsOptions: TlsConnectionOptions,
    unsafeAllowInsecureAuthForTests: boolean,
  ) {
    this.connection = connection
    this.limits = limits
    this.tlsOptions = tlsOptions
    this.unsafeAllowInsecureAuthForTests = unsafeAllowInsecureAuthForTests
  }

  static async connect(options: ImapClientOptions): Promise<ImapClient> {
    const limits = resolveLimits(options.limits)
    const unsafeAllowInsecureAuthForTests = validateUnsafeAuthOption(
      options.unsafeAllowInsecureAuthForTests,
    )
    const connection = await BoundedConnection.connect({
      host: options.host,
      port: options.port,
      tls: options.tls ?? 'none',
      tlsOptions: options.tlsOptions,
      limits,
      signal: options.signal,
      connectTimeoutMs: options.connectTimeoutMs,
    })
    const client = new ImapClient(
      connection,
      limits,
      options.tlsOptions ?? {},
      unsafeAllowInsecureAuthForTests,
    )
    try {
      const greeting = await readImapResponse(connection, { signal: options.signal })
      client.greetingValue = greeting
      if (greeting.status === 'BYE') {
        throw new ProtocolError(
          'CONNECT_FAILED',
          `Server refused the connection: ${greeting.text}`,
          {
            protocol: 'imap',
          },
        )
      }
      client.stateValue = greeting.status === 'PREAUTH' ? 'authenticated' : 'not_authenticated'
      client.capabilitiesValue = collectImapCapabilities([greeting])
      return client
    } catch (error) {
      connection.close()
      throw error
    }
  }

  get greeting(): ImapResponse | null {
    return this.greetingValue
  }

  get state(): ImapState {
    return this.stateValue
  }

  get isAuthenticated(): boolean {
    return this.stateValue === 'authenticated'
  }

  get isEncrypted(): boolean {
    return this.connection.isEncrypted
  }

  get capabilities(): ImapCapabilities {
    return this.capabilitiesValue
  }

  /** Issues CAPABILITY and replaces the cached capability set. */
  async capability(options: OperationOptions = {}): Promise<ImapCapabilities> {
    const result = await this.command('CAPABILITY', undefined, options)
    if (result.status !== 'OK') {
      throw new ProtocolError('PROTOCOL_ERROR', `CAPABILITY failed: ${result.text}`, {
        protocol: 'imap',
      })
    }
    this.capabilitiesValue = collectImapCapabilities(result.untagged)
    return this.capabilitiesValue
  }

  /** Upgrades to TLS after a successful STARTTLS command, then re-reads capabilities. */
  async startTls(options: OperationOptions = {}): Promise<void> {
    if (this.connection.isEncrypted) {
      throw new ProtocolError('PROTOCOL_ERROR', 'TLS is already active', { protocol: 'imap' })
    }
    if (this.capabilitiesValue.tokens.length === 0) {
      await this.capability(options)
    }
    if (!this.capabilitiesValue.startTls) {
      throw new ProtocolError('STARTTLS_UNSUPPORTED', 'Server does not advertise STARTTLS', {
        protocol: 'imap',
      })
    }

    const result = await this.command('STARTTLS', undefined, options)
    if (result.status !== 'OK') {
      throw new ProtocolError('STARTTLS_UNSUPPORTED', `STARTTLS rejected: ${result.text}`, {
        protocol: 'imap',
      })
    }

    await this.connection.startTls(this.tlsOptions, options)
    this.capabilitiesValue = emptyImapCapabilities()
    await this.capability(options)
  }

  /**
   * Authenticates with the `LOGIN` command. Fails fast when the server
   * advertises `LOGINDISABLED`, steering callers toward STARTTLS.
   */
  async login(
    username: string,
    password: string,
    options: OperationOptions = {},
  ): Promise<ImapCommandResult> {
    this.ensureAuthTransport()
    if (this.capabilitiesValue.loginDisabled) {
      throw new ProtocolError(
        'TLS_REQUIRED',
        'Server advertises LOGINDISABLED; establish TLS before authenticating',
        { protocol: 'imap' },
      )
    }
    const args = `${quoteImapString(username)} ${quoteImapString(password)}`
    const result = await this.command('LOGIN', args, options)
    if (result.status !== 'OK') {
      throw new ProtocolError('AUTH_FAILED', `LOGIN failed: ${result.text}`, { protocol: 'imap' })
    }
    this.stateValue = 'authenticated'
    return result
  }

  /**
   * Authenticates with a SASL mechanism (PLAIN, LOGIN, XOAUTH2), honoring the
   * server's `+` continuations. When capabilities are known, the mechanism must
   * be advertised as `AUTH=<MECHANISM>`.
   */
  async authenticate(
    mechanism: string,
    credentials: SaslCredentials,
    options: OperationOptions = {},
  ): Promise<void> {
    this.ensureAuthTransport()
    const upper = mechanism.toUpperCase()
    if (!isImapAuthMechanism(upper)) {
      throw new ProtocolError('AUTH_UNSUPPORTED', `Unsupported IMAP SASL mechanism: ${mechanism}`, {
        protocol: 'imap',
      })
    }
    if (this.capabilitiesValue.tokens.length > 0 && !this.capabilitiesValue.supportsAuth(upper)) {
      throw new ProtocolError('AUTH_UNSUPPORTED', `Server does not advertise AUTH=${upper}`, {
        protocol: 'imap',
        details: { mechanism: upper, advertised: this.capabilitiesValue.authMechanisms },
      })
    }

    const tag = this.nextTag()
    const initial = imapInitialResponse(upper, credentials)
    const line =
      initial === null ? `${tag} AUTHENTICATE ${upper}` : `${tag} AUTHENTICATE ${upper} ${initial}`
    await this.connection.writeLine(line, options)

    let step = 0
    for (;;) {
      const response = await readImapResponse(this.connection, options)
      if (response.prefix.kind === 'continuation') {
        const next = imapContinuationResponse(upper, credentials, step)
        step += 1
        if (next === null) {
          throw new ProtocolError('PROTOCOL_ERROR', 'Unexpected SASL continuation', {
            protocol: 'imap',
          })
        }
        await this.connection.writeLine(next, options)
        continue
      }
      if (response.prefix.kind === 'tagged') {
        if (response.prefix.tag !== tag) {
          throw new ProtocolError('UNEXPECTED_RESPONSE', `Mismatched tag: ${response.prefix.tag}`, {
            protocol: 'imap',
          })
        }
        if (response.status === 'OK') {
          this.stateValue = 'authenticated'
          return
        }
        throw new ProtocolError('AUTH_FAILED', `Authentication failed: ${response.text}`, {
          protocol: 'imap',
        })
      }
    }
  }

  /** Sends a NOOP and drains the tagged response. */
  noop(options: OperationOptions = {}): Promise<ImapCommandResult> {
    return this.command('NOOP', undefined, options)
  }

  /** Issues LOGOUT, drains the tagged response and closes the connection. */
  async logout(options: OperationOptions = {}): Promise<ImapCommandResult> {
    const result = await this.command('LOGOUT', undefined, options)
    this.stateValue = 'logout'
    this.connection.close()
    return result
  }

  /** Sends an arbitrary tagged command and collects untagged responses until the tag returns. */
  async command(
    name: string,
    args?: string,
    options: OperationOptions = {},
  ): Promise<ImapCommandResult> {
    if (this.stateValue === 'logout') {
      throw new ProtocolError('CONNECTION_CLOSED', 'Client is logging out', { protocol: 'imap' })
    }
    assertNoWireControlBytes(name, 'IMAP command name', 'imap')
    if (args !== undefined) assertNoWireControlBytes(args, 'IMAP command arguments', 'imap')
    const commandUpper = name.toUpperCase()
    if (commandUpper === 'LOGIN' || commandUpper === 'AUTHENTICATE') {
      this.ensureAuthTransport()
    }
    const tag = this.nextTag()
    const line = args === undefined ? `${tag} ${name}` : `${tag} ${name} ${args}`
    await this.connection.writeLine(line, options)

    const untagged: ImapResponse[] = []
    const rawParts: Buffer[] = []
    let total = 0

    for (;;) {
      const response = await readImapResponse(this.connection, options)
      rawParts.push(response.raw)
      total += response.raw.length
      if (total > this.limits.maxResponseBytes) {
        throw new ProtocolError(
          'LIMIT_EXCEEDED',
          'Command response exceeded the configured limit',
          {
            protocol: 'imap',
            details: { limit: this.limits.maxResponseBytes },
          },
        )
      }

      if (response.prefix.kind === 'continuation') {
        throw new ProtocolError('PROTOCOL_ERROR', `Unexpected continuation for ${name}`, {
          protocol: 'imap',
        })
      }

      if (response.prefix.kind === 'tagged') {
        if (response.prefix.tag !== tag) {
          throw new ProtocolError(
            'UNEXPECTED_RESPONSE',
            `Mismatched tag ${response.prefix.tag} (expected ${tag})`,
            { protocol: 'imap' },
          )
        }
        const status = response.status
        if (status !== 'OK' && status !== 'NO' && status !== 'BAD') {
          throw new ProtocolError(
            'UNEXPECTED_RESPONSE',
            `Invalid tagged status: ${response.text}`,
            {
              protocol: 'imap',
            },
          )
        }
        return { tag, status, text: response.rest, untagged, raw: Buffer.concat(rawParts) }
      }

      untagged.push(response)
    }
  }

  close(): void {
    this.stateValue = 'logout'
    this.connection.close()
  }

  private ensureAuthTransport(): void {
    if (!this.connection.isEncrypted && !this.unsafeAllowInsecureAuthForTests) {
      throw new ProtocolError('TLS_REQUIRED', 'TLS is required before IMAP authentication', {
        protocol: 'imap',
      })
    }
  }

  private nextTag(): string {
    this.counter += 1
    return `A${String(this.counter).padStart(4, '0')}`
  }
}

/** Quotes an IMAP string literal, rejecting CR/LF to prevent command injection. */
export function quoteImapString(value: string): string {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code === 0x0d || code === 0x0a || code === 0) {
      throw new ProtocolError('AUTH_FAILED', 'Illegal control character in IMAP string', {
        protocol: 'imap',
      })
    }
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function validateUnsafeAuthOption(value: boolean | undefined): boolean {
  if (value !== true) return false
  if (process.env.NODE_ENV !== 'test') {
    throw new ProtocolError(
      'PROTOCOL_ERROR',
      'unsafeAllowInsecureAuthForTests is only available in NODE_ENV=test',
      { protocol: 'imap' },
    )
  }
  return true
}
