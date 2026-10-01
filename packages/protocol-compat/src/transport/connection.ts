import { assertNoWireControlBytes } from '../common/wire.js'
import { connect as netConnect, type Socket } from 'node:net'
import {
  connect as tlsConnect,
  type ConnectionOptions as TlsConnectionOptions,
  type TLSSocket,
} from 'node:tls'
import { ProtocolError, normalizeError } from '../common/errors.js'
import { resolveLimits, type ProtocolLimits } from '../common/limits.js'
import {
  abortReasonToError,
  createDeadline,
  type Deadline,
  type OperationOptions,
} from '../common/timeout.js'
import { ChunkBuffer } from './chunk-buffer.js'
import type { ConnectionOptions } from './types.js'

type AnySocket = Socket | TLSSocket

interface PendingRead {
  kind: 'line' | 'exact'
  bytes: number
  resolve: (value: Buffer) => void
  reject: (error: ProtocolError) => void
  deadline: Deadline
  onAbort: () => void
}

const CRLF = '\r\n'

/**
 * A single bidirectional protocol connection over TCP or TLS with hard bounds on
 * line length, literal size, response size and operation time. Reads are
 * incremental: callers ask for a line or an exact byte count and the connection
 * waits for the socket to deliver enough data. Any timeout or cancellation is
 * terminal for the connection, because IMAP/SMTP cannot resynchronize a partial
 * frame.
 */
export class BoundedConnection {
  private socket: AnySocket
  readonly limits: ProtocolLimits
  private encrypted: boolean
  private buffer = new ChunkBuffer()
  private pending: PendingRead | null = null
  private failure: ProtocolError | null = null
  private closed = false

  private readonly onData = (chunk: Buffer): void => {
    this.buffer.push(chunk)
    if (this.pending === null) {
      if (this.buffer.size > this.limits.maxResponseBytes) {
        this.fail(
          new ProtocolError('LIMIT_EXCEEDED', 'Unsolicited data exceeded the response limit', {
            protocol: 'transport',
            details: { limit: this.limits.maxResponseBytes },
          }),
        )
      }
      return
    }
    this.pump()
  }

  private readonly onError = (error: Error): void => {
    this.fail(normalizeError(error, { code: 'CONNECTION_CLOSED', protocol: 'transport' }))
  }

  private readonly onClose = (): void => {
    this.fail(
      new ProtocolError('CONNECTION_CLOSED', 'Connection closed by peer', {
        protocol: 'transport',
      }),
    )
  }

  private constructor(socket: AnySocket, limits: ProtocolLimits, encrypted: boolean) {
    this.socket = socket
    this.limits = limits
    this.encrypted = encrypted
    this.attach(socket)
  }

  static async connect(options: ConnectionOptions): Promise<BoundedConnection> {
    const limits = resolveLimits(options.limits)
    const tlsMode = options.tls ?? 'none'
    const host = options.host
    const port = options.port
    const deadline = createDeadline(
      options.signal,
      options.connectTimeoutMs ?? limits.connectTimeoutMs,
    )

    const socket: AnySocket =
      tlsMode === 'implicit'
        ? tlsConnect({ host, port, servername: host, ...options.tlsOptions })
        : netConnect({ host, port })

    try {
      await BoundedConnection.awaitConnected(socket, tlsMode === 'implicit', deadline)
    } catch (error) {
      socket.destroy()
      throw error
    } finally {
      deadline.dispose()
    }

    return new BoundedConnection(socket, limits, tlsMode === 'implicit')
  }

  private static awaitConnected(
    socket: AnySocket,
    secure: boolean,
    deadline: Deadline,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        cleanup()
        resolve()
      }
      const onError = (error: Error): void => {
        cleanup()
        reject(
          normalizeError(error, {
            code: secure ? 'TLS_FAILED' : 'CONNECT_FAILED',
            protocol: 'transport',
          }),
        )
      }
      const onAbort = (): void => {
        cleanup()
        reject(abortReasonToError(deadline.signal, 'transport', { operation: 'connect' }))
      }
      const cleanup = (): void => {
        socket.removeListener('connect', onReady)
        socket.removeListener('secureConnect', onReady)
        socket.removeListener('error', onError)
        deadline.signal.removeEventListener('abort', onAbort)
      }

      socket.once(secure ? 'secureConnect' : 'connect', onReady)
      socket.once('error', onError)
      if (deadline.signal.aborted) onAbort()
      else deadline.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  get isEncrypted(): boolean {
    return this.encrypted
  }

  get isClosed(): boolean {
    return this.closed
  }

  get remoteAddress(): string | undefined {
    return this.socket.remoteAddress ?? undefined
  }

  /** Reads up to (and consuming) the next CRLF, returning the line without CRLF. */
  readLine(options: OperationOptions = {}): Promise<Buffer> {
    return this.read('line', 0, options)
  }

  /** Reads exactly `bytes` raw bytes (used for IMAP literals). */
  readExact(bytes: number, options: OperationOptions = {}): Promise<Buffer> {
    if (!Number.isInteger(bytes) || bytes < 0) {
      throw new ProtocolError('PROTOCOL_ERROR', `Invalid read length: ${bytes}`, {
        protocol: 'transport',
      })
    }
    if (bytes > this.limits.maxLiteralBytes) {
      throw new ProtocolError('LIMIT_EXCEEDED', 'Literal exceeds the configured limit', {
        protocol: 'transport',
        details: { requested: bytes, limit: this.limits.maxLiteralBytes },
      })
    }
    return this.read('exact', bytes, options)
  }

  write(data: Buffer | string, options: OperationOptions = {}): Promise<void> {
    if (this.failure !== null) return Promise.reject(this.failure)
    if (this.closed) return Promise.reject(BoundedConnection.closedError())

    return new Promise<void>((resolve, reject) => {
      const deadline = createDeadline(
        options.signal,
        options.timeoutMs ?? this.limits.commandTimeoutMs,
      )
      const onAbort = (): void => {
        const error = abortReasonToError(deadline.signal, 'transport', { operation: 'write' })
        deadline.dispose()
        deadline.signal.removeEventListener('abort', onAbort)
        reject(error)
        this.terminate(error)
      }
      deadline.signal.addEventListener('abort', onAbort, { once: true })
      if (deadline.signal.aborted) {
        onAbort()
        return
      }

      this.socket.write(data, (error?: Error | null) => {
        deadline.dispose()
        deadline.signal.removeEventListener('abort', onAbort)
        if (error) {
          reject(normalizeError(error, { code: 'CONNECTION_CLOSED', protocol: 'transport' }))
        } else {
          resolve()
        }
      })
    })
  }

  /** Writes a single CRLF-terminated, injection-safe line. */
  async writeLine(line: string, options: OperationOptions = {}): Promise<void> {
    assertNoWireControlBytes(line, 'protocol line')
    const lineBytes = Buffer.byteLength(line, 'utf8') + 2
    if (lineBytes > this.limits.maxLineBytes) {
      throw new ProtocolError('LIMIT_EXCEEDED', 'Protocol line exceeded the configured limit', {
        protocol: 'transport',
        details: { bytes: lineBytes, limit: this.limits.maxLineBytes },
      })
    }
    await this.write(`${line}${CRLF}`, options)
  }

  /**
   * Upgrades the plaintext connection to TLS after a STARTTLS exchange. Any
   * buffered plaintext indicates a protocol violation and aborts the upgrade.
   */
  startTls(tlsOptions: TlsConnectionOptions = {}, options: OperationOptions = {}): Promise<void> {
    if (this.encrypted) {
      throw new ProtocolError('PROTOCOL_ERROR', 'TLS is already active on this connection', {
        protocol: 'transport',
      })
    }
    if (this.failure !== null) {
      throw this.failure
    }
    if (this.buffer.size > 0) {
      throw new ProtocolError('PROTOCOL_ERROR', 'Buffered plaintext present before STARTTLS', {
        protocol: 'transport',
        details: { bufferedBytes: this.buffer.size },
      })
    }

    const raw = this.socket
    this.detach(raw)

    return new Promise<void>((resolve, reject) => {
      const deadline = createDeadline(
        options.signal,
        options.timeoutMs ?? this.limits.commandTimeoutMs,
      )
      let secure: TLSSocket
      try {
        secure = tlsConnect({ socket: raw, servername: tlsOptions.servername, ...tlsOptions })
      } catch (error) {
        const failure = normalizeError(error, { code: 'TLS_FAILED', protocol: 'transport' })
        this.socket = raw
        this.terminate(failure)
        reject(failure)
        return
      }

      const onSecure = (): void => {
        cleanup()
        this.attach(secure, true)
        resolve()
      }
      const onError = (error: Error): void => {
        cleanup()
        const failure = normalizeError(error, { code: 'TLS_FAILED', protocol: 'transport' })
        this.socket = secure
        secure.on('error', () => undefined)
        this.terminate(failure)
        reject(failure)
      }
      const onAbort = (): void => {
        cleanup()
        const failure = abortReasonToError(deadline.signal, 'transport', { operation: 'starttls' })
        this.socket = secure
        secure.on('error', () => undefined)
        this.terminate(failure)
        reject(failure)
      }
      const cleanup = (): void => {
        deadline.dispose()
        secure.removeListener('secureConnect', onSecure)
        secure.removeListener('error', onError)
        deadline.signal.removeEventListener('abort', onAbort)
      }

      secure.once('secureConnect', onSecure)
      secure.once('error', onError)
      if (deadline.signal.aborted) onAbort()
      else deadline.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  close(): void {
    if (this.closed) return
    const error = new ProtocolError('CONNECTION_CLOSED', 'Connection closed locally', {
      protocol: 'transport',
    })
    this.terminate(error)
  }

  private read(kind: 'line' | 'exact', bytes: number, options: OperationOptions): Promise<Buffer> {
    if (this.failure !== null) return Promise.reject(this.failure)
    if (this.closed) return Promise.reject(BoundedConnection.closedError())
    if (this.pending !== null) {
      return Promise.reject(
        new ProtocolError('PROTOCOL_ERROR', 'Concurrent read on a protocol connection', {
          protocol: 'transport',
        }),
      )
    }

    return new Promise<Buffer>((resolve, reject) => {
      const deadline = createDeadline(
        options.signal,
        options.timeoutMs ?? this.limits.commandTimeoutMs,
      )
      const onAbort = (): void => {
        this.fail(abortReasonToError(deadline.signal, 'transport', { operation: 'read' }))
      }
      this.pending = { kind, bytes, resolve, reject, deadline, onAbort }
      deadline.signal.addEventListener('abort', onAbort, { once: true })
      if (deadline.signal.aborted) {
        onAbort()
        return
      }
      this.pump()
    })
  }

  private pump(): void {
    const pending = this.pending
    if (pending === null) return

    if (pending.kind === 'line') {
      const index = this.buffer.findCrlf()
      if (index >= 0) {
        const frame = this.buffer.consume(index + 2)
        this.resolvePending(frame.subarray(0, index))
        return
      }
      if (this.buffer.size > this.limits.maxLineBytes) {
        this.fail(
          new ProtocolError('LIMIT_EXCEEDED', 'Protocol line exceeded the configured limit', {
            protocol: 'transport',
            details: { limit: this.limits.maxLineBytes },
          }),
        )
      }
      return
    }

    if (this.buffer.size >= pending.bytes) {
      this.resolvePending(this.buffer.consume(pending.bytes))
    }
  }

  private resolvePending(value: Buffer): void {
    const pending = this.pending
    if (pending === null) return
    this.pending = null
    pending.deadline.dispose()
    pending.deadline.signal.removeEventListener('abort', pending.onAbort)
    pending.resolve(value)
  }

  private settlePending(error: ProtocolError): void {
    const pending = this.pending
    if (pending === null) return
    this.pending = null
    pending.deadline.dispose()
    pending.deadline.signal.removeEventListener('abort', pending.onAbort)
    pending.reject(error)
  }

  private fail(error: ProtocolError): void {
    if (this.failure === null) this.failure = error
    this.settlePending(error)
    this.terminate(error)
  }

  /** Marks the connection dead and destroys the socket without settling callers. */
  private terminate(error: ProtocolError): void {
    if (this.failure === null) this.failure = error
    this.closed = true
    this.settlePending(error)
    try {
      this.socket.destroy()
    } catch {
      // Socket already destroyed.
    }
  }

  private attach(socket: AnySocket, encrypted = this.encrypted): void {
    this.socket = socket
    this.encrypted = encrypted
    this.buffer.clear()
    socket.on('data', this.onData)
    socket.on('error', this.onError)
    socket.on('close', this.onClose)
  }

  private detach(socket: AnySocket): void {
    socket.removeListener('data', this.onData)
    socket.removeListener('error', this.onError)
    socket.removeListener('close', this.onClose)
  }

  private static closedError(): ProtocolError {
    return new ProtocolError('CONNECTION_CLOSED', 'Connection is closed', { protocol: 'transport' })
  }
}
