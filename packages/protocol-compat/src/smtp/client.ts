import { assertNoWireControlBytes } from '../common/wire.js'
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls'
import { ProtocolError } from '../common/errors.js'
import { formatMailbox } from '../common/address.js'
import { resolveLimits, type ProtocolLimits } from '../common/limits.js'
import type { SaslCredentials } from '../common/sasl.js'
import type { OperationOptions } from '../common/timeout.js'
import { BoundedConnection } from '../transport/connection.js'
import type { TlsMode } from '../transport/types.js'
import {
  isSmtpAuthMechanism,
  smtpInitialResponse,
  smtpLoginPassword,
  smtpLoginUsername,
} from './auth.js'
import { emptySmtpCapabilities, parseSmtpCapabilities, SmtpCapabilities } from './capabilities.js'
import { assertPreparedDataSize, prepareData } from './dot-stuffing.js'
import { buildMessage, type MailboxLike, type OutgoingMessage } from './message.js'
import { readSmtpReply, type SmtpReply } from './parser.js'

export interface SmtpClientOptions {
  host: string
  port: number
  /** Defaults to `none`. Use `implicit` for port 465 or `starttls` for 587. */
  tls?: TlsMode
  tlsOptions?: TlsConnectionOptions
  limits?: Partial<ProtocolLimits>
  signal?: AbortSignal
  connectTimeoutMs?: number
  /** Name announced in EHLO. Defaults to `localhost`. */
  helloName?: string
  /** Test-only escape hatch; production callers must establish TLS first. */
  unsafeAllowInsecureAuthForTests?: boolean
}

export interface SmtpTransactionReplies {
  mailFrom: SmtpReply
  recipients: SmtpReply[]
  data: SmtpReply
}

export interface SmtpSendResult {
  messageId?: string
  acceptedRecipients: string[]
  replies: SmtpTransactionReplies
}

interface ReplyRequirement {
  context: string
  rejectCode: 'MESSAGE_REJECTED' | 'RECIPIENT_REJECTED'
}

const MESSAGE_ID_PATTERN = /^Message-ID: <([^>]+)>/m

function mailboxAddress(mailbox: MailboxLike): string {
  return typeof mailbox === 'string' ? mailbox : mailbox.address
}

/** A bounded SMTP submission client with STARTTLS, SASL auth and DATA dot-stuffing. */
export class SmtpClient {
  private readonly connection: BoundedConnection
  private readonly limits: ProtocolLimits
  private readonly tlsOptions: TlsConnectionOptions
  private readonly helloName: string
  private readonly unsafeAllowInsecureAuthForTests: boolean
  private capabilitiesValue: SmtpCapabilities = emptySmtpCapabilities()
  private tlsActive = false
  private greetingValue: SmtpReply | null = null

  private constructor(
    connection: BoundedConnection,
    limits: ProtocolLimits,
    tlsOptions: TlsConnectionOptions,
    helloName: string,
    unsafeAllowInsecureAuthForTests: boolean,
  ) {
    this.connection = connection
    this.limits = limits
    this.tlsOptions = tlsOptions
    this.helloName = helloName
    this.unsafeAllowInsecureAuthForTests = unsafeAllowInsecureAuthForTests
  }

  static async connect(options: SmtpClientOptions): Promise<SmtpClient> {
    const limits = resolveLimits(options.limits)
    const helloName = options.helloName ?? 'localhost'
    assertNoWireControlBytes(helloName, 'SMTP helloName', 'smtp')
    if (helloName.length === 0) {
      throw new ProtocolError('MESSAGE_REJECTED', 'SMTP helloName must not be empty', {
        protocol: 'smtp',
      })
    }
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
    const client = new SmtpClient(
      connection,
      limits,
      options.tlsOptions ?? {},
      helloName,
      unsafeAllowInsecureAuthForTests,
    )
    try {
      const greeting = await readSmtpReply(connection, { signal: options.signal })
      client.greetingValue = greeting
      if (greeting.code !== 220) {
        throw new ProtocolError(
          'CONNECT_FAILED',
          `Unexpected SMTP greeting ${greeting.code}: ${greeting.text}`,
          { protocol: 'smtp', details: { replyCode: greeting.code } },
        )
      }
      client.tlsActive = connection.isEncrypted
      await client.ehlo({ signal: options.signal })
      return client
    } catch (error) {
      connection.close()
      throw error
    }
  }

  get greeting(): SmtpReply | null {
    return this.greetingValue
  }

  get capabilities(): SmtpCapabilities {
    return this.capabilitiesValue
  }

  get isEncrypted(): boolean {
    return this.connection.isEncrypted
  }

  /** Sends EHLO and replaces the cached capability set. */
  async ehlo(options: OperationOptions = {}): Promise<SmtpCapabilities> {
    const reply = await this.exchange(`EHLO ${this.helloName}`, options)
    if (reply.code !== 250) {
      throw new ProtocolError('UNEXPECTED_RESPONSE', `EHLO failed: ${reply.code} ${reply.text}`, {
        protocol: 'smtp',
        details: { replyCode: reply.code },
      })
    }
    this.capabilitiesValue = parseSmtpCapabilities(reply.lines)
    return this.capabilitiesValue
  }

  /** Upgrades to TLS after STARTTLS and re-issues EHLO. */
  async startTls(options: OperationOptions = {}): Promise<void> {
    if (this.tlsActive) {
      throw new ProtocolError('PROTOCOL_ERROR', 'TLS is already active', { protocol: 'smtp' })
    }
    if (!this.capabilitiesValue.startTls) {
      throw new ProtocolError('STARTTLS_UNSUPPORTED', 'Server does not advertise STARTTLS', {
        protocol: 'smtp',
      })
    }
    const reply = await this.exchange('STARTTLS', options)
    if (reply.code !== 220) {
      throw new ProtocolError(
        'STARTTLS_UNSUPPORTED',
        `STARTTLS rejected: ${reply.code} ${reply.text}`,
        { protocol: 'smtp', details: { replyCode: reply.code } },
      )
    }
    await this.connection.startTls(this.tlsOptions, options)
    this.tlsActive = true
    this.capabilitiesValue = emptySmtpCapabilities()
    await this.ehlo(options)
  }

  /**
   * Authenticates with PLAIN, LOGIN or XOAUTH2. When capabilities are known,
   * the mechanism must be advertised by the server.
   */
  async authenticate(
    mechanism: string,
    credentials: SaslCredentials,
    options: OperationOptions = {},
  ): Promise<void> {
    this.ensureAuthTransport()
    const upper = mechanism.toUpperCase()
    if (!isSmtpAuthMechanism(upper)) {
      throw new ProtocolError('AUTH_UNSUPPORTED', `Unsupported SMTP SASL mechanism: ${mechanism}`, {
        protocol: 'smtp',
      })
    }
    if (this.capabilitiesValue.tokens.length > 0 && !this.capabilitiesValue.supportsAuth(upper)) {
      throw new ProtocolError('AUTH_UNSUPPORTED', `Server does not advertise AUTH ${upper}`, {
        protocol: 'smtp',
        details: { mechanism: upper, advertised: this.capabilitiesValue.authMechanisms },
      })
    }

    if (upper === 'LOGIN') {
      await this.authLogin(credentials, options)
      return
    }

    const initial = smtpInitialResponse(upper, credentials)
    let reply = await this.exchange(
      initial === null ? `AUTH ${upper}` : `AUTH ${upper} ${initial}`,
      options,
    )
    if (reply.code === 235) return

    if (reply.code === 334 && upper === 'XOAUTH2') {
      // On failure the server returns a 334 error blob; acknowledge with an empty line.
      const final = await this.exchange('', options)
      throw new ProtocolError('AUTH_FAILED', `Authentication failed: ${final.code} ${final.text}`, {
        protocol: 'smtp',
        details: { replyCode: final.code },
      })
    }

    if (reply.code === 334) {
      reply = await this.exchange(initial ?? '', options)
      if (reply.code === 235) return
    }

    throw new ProtocolError('AUTH_FAILED', `Authentication failed: ${reply.code} ${reply.text}`, {
      protocol: 'smtp',
      details: { replyCode: reply.code },
    })
  }

  private async authLogin(credentials: SaslCredentials, options: OperationOptions): Promise<void> {
    let reply = await this.exchange('AUTH LOGIN', options)
    if (reply.code === 235) return
    if (reply.code !== 334) {
      throw new ProtocolError('AUTH_FAILED', `Authentication failed: ${reply.code} ${reply.text}`, {
        protocol: 'smtp',
        details: { replyCode: reply.code },
      })
    }

    reply = await this.exchange(smtpLoginUsername(credentials), options)
    if (reply.code === 235) return
    if (reply.code !== 334) {
      throw new ProtocolError('AUTH_FAILED', `Authentication failed: ${reply.code} ${reply.text}`, {
        protocol: 'smtp',
        details: { replyCode: reply.code },
      })
    }

    reply = await this.exchange(smtpLoginPassword(credentials), options)
    if (reply.code !== 235) {
      throw new ProtocolError('AUTH_FAILED', `Authentication failed: ${reply.code} ${reply.text}`, {
        protocol: 'smtp',
        details: { replyCode: reply.code },
      })
    }
  }

  async mailFrom(address: string, options: OperationOptions = {}): Promise<SmtpReply> {
    const reply = await this.exchange(`MAIL FROM:${formatMailbox(address)}`, options)
    this.requireReply(reply, [250], { context: 'MAIL FROM', rejectCode: 'MESSAGE_REJECTED' })
    return reply
  }

  async rcptTo(address: string, options: OperationOptions = {}): Promise<SmtpReply> {
    const reply = await this.exchange(`RCPT TO:${formatMailbox(address)}`, options)
    this.requireReply(reply, [250, 251], { context: 'RCPT TO', rejectCode: 'RECIPIENT_REJECTED' })
    return reply
  }

  /** Sends DATA, streams the dot-stuffed body and returns the final acceptance reply. */
  async data(body: string | Buffer, options: OperationOptions = {}): Promise<SmtpReply> {
    assertPreparedDataSize(body, this.limits.maxMessageBytes)
    const prompt = await this.exchange('DATA', options)
    this.requireReply(prompt, [354], { context: 'DATA', rejectCode: 'MESSAGE_REJECTED' })
    await this.connection.write(prepareData(body, this.limits.maxMessageBytes), options)
    const reply = await this.readReply(options)
    this.requireReply(reply, [250], { context: 'DATA payload', rejectCode: 'MESSAGE_REJECTED' })
    return reply
  }

  /**
   * Runs a full MAIL FROM → RCPT TO → DATA transaction for a message. On any
   * rejection the transaction is aborted with RSET before the error propagates.
   */
  async sendTransaction(
    message: OutgoingMessage,
    options: OperationOptions = {},
  ): Promise<SmtpSendResult> {
    const envelope = buildMessage(message, this.limits.maxMessageBytes)
    const sizeLimit = this.capabilitiesValue.sizeLimit
    if (sizeLimit !== undefined && envelope.length > sizeLimit) {
      throw new ProtocolError('LIMIT_EXCEEDED', 'Message exceeds the server SIZE limit', {
        protocol: 'smtp',
        details: { size: envelope.length, limit: sizeLimit },
      })
    }

    const recipients: MailboxLike[] = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])]

    const mailFrom = await this.mailFrom(mailboxAddress(message.from), options)
    const recipientReplies: SmtpReply[] = []
    const acceptedRecipients: string[] = []
    try {
      for (const recipient of recipients) {
        const address = mailboxAddress(recipient)
        const reply = await this.rcptTo(address, options)
        recipientReplies.push(reply)
        acceptedRecipients.push(address)
      }
      const dataReply = await this.data(envelope, options)
      return {
        messageId: extractMessageId(envelope),
        acceptedRecipients,
        replies: { mailFrom, recipients: recipientReplies, data: dataReply },
      }
    } catch (error) {
      await this.tryRset(options)
      throw error
    }
  }

  async rset(options: OperationOptions = {}): Promise<SmtpReply> {
    const reply = await this.exchange('RSET', options)
    this.requireReply(reply, [250], { context: 'RSET', rejectCode: 'MESSAGE_REJECTED' })
    return reply
  }

  async quit(options: OperationOptions = {}): Promise<SmtpReply> {
    const reply = await this.exchange('QUIT', options)
    this.connection.close()
    return reply
  }

  close(): void {
    this.connection.close()
  }

  private async exchange(line: string, options: OperationOptions): Promise<SmtpReply> {
    assertNoWireControlBytes(line, 'SMTP command', 'smtp')
    await this.connection.writeLine(line, options)
    return this.readReply(options)
  }

  private async readReply(options: OperationOptions): Promise<SmtpReply> {
    try {
      return await readSmtpReply(this.connection, options)
    } catch (error) {
      this.connection.close()
      throw error
    }
  }

  private ensureAuthTransport(): void {
    if (!this.connection.isEncrypted && !this.unsafeAllowInsecureAuthForTests) {
      throw new ProtocolError('TLS_REQUIRED', 'TLS is required before SMTP authentication', {
        protocol: 'smtp',
      })
    }
  }

  private async tryRset(options: OperationOptions): Promise<void> {
    try {
      await this.rset(options)
    } catch {
      // The connection may already be closed; the original error is authoritative.
    }
  }

  private requireReply(reply: SmtpReply, allowed: number[], requirement: ReplyRequirement): void {
    if (allowed.includes(reply.code)) return
    if (reply.code >= 400 && reply.code < 500) {
      throw new ProtocolError(
        'SEND_FAILED',
        `${requirement.context} deferred: ${reply.code} ${reply.text}`,
        {
          protocol: 'smtp',
          details: { replyCode: reply.code, context: requirement.context },
        },
      )
    }
    throw new ProtocolError(
      requirement.rejectCode,
      `${requirement.context} rejected: ${reply.code} ${reply.text}`,
      { protocol: 'smtp', details: { replyCode: reply.code, context: requirement.context } },
    )
  }
}

function extractMessageId(envelope: Buffer): string | undefined {
  const match = MESSAGE_ID_PATTERN.exec(envelope.toString('latin1'))
  return match?.[1]
}

function validateUnsafeAuthOption(value: boolean | undefined): boolean {
  if (value !== true) return false
  if (process.env.NODE_ENV !== 'test') {
    throw new ProtocolError(
      'PROTOCOL_ERROR',
      'unsafeAllowInsecureAuthForTests is only available in NODE_ENV=test',
      { protocol: 'smtp' },
    )
  }
  return true
}
