import type { Socket } from 'node:net'

interface LineWaiter {
  resolve: (value: string) => void
  reject: (error: Error) => void
}

interface ExactWaiter {
  count: number
  resolve: (value: Buffer) => void
  reject: (error: Error) => void
}

interface TerminatorWaiter {
  terminator: Buffer
  resolve: (value: Buffer) => void
  reject: (error: Error) => void
}

const CRLF = Buffer.from('\r\n')

/**
 * A minimal incremental reader for test fixture servers. It intentionally uses
 * simple Buffer concatenation; fixtures exchange small, bounded payloads.
 */
export class SocketReader {
  private buffer = Buffer.alloc(0)
  private lineWaiter: LineWaiter | null = null
  private exactWaiter: ExactWaiter | null = null
  private terminatorWaiter: TerminatorWaiter | null = null
  private failure: Error | null = null

  private readonly onData = (chunk: Buffer): void => {
    this.buffer = Buffer.concat([this.buffer, chunk])
    this.pump()
  }

  private readonly onClose = (): void => {
    this.fail(new Error('fixture socket closed'))
  }

  private readonly onError = (error: Error): void => {
    this.fail(error)
  }

  constructor(private socket: Socket) {
    socket.on('data', this.onData)
    socket.on('close', this.onClose)
    socket.on('error', this.onError)
  }

  dispose(): void {
    this.socket.removeListener('data', this.onData)
    this.socket.removeListener('close', this.onClose)
    this.socket.removeListener('error', this.onError)
  }

  readLine(): Promise<string> {
    if (this.failure !== null) return Promise.reject(this.failure)
    return new Promise<string>((resolve, reject) => {
      this.lineWaiter = { resolve, reject }
      this.pump()
    })
  }

  readExact(count: number): Promise<Buffer> {
    if (this.failure !== null) return Promise.reject(this.failure)
    return new Promise<Buffer>((resolve, reject) => {
      this.exactWaiter = { count, resolve, reject }
      this.pump()
    })
  }

  readUntil(terminator: Buffer): Promise<Buffer> {
    if (this.failure !== null) return Promise.reject(this.failure)
    return new Promise<Buffer>((resolve, reject) => {
      this.terminatorWaiter = { terminator, resolve, reject }
      this.pump()
    })
  }

  private pump(): void {
    if (this.lineWaiter !== null) {
      const index = this.buffer.indexOf(CRLF)
      if (index >= 0) {
        const line = this.buffer.subarray(0, index).toString('utf8')
        this.buffer = this.buffer.subarray(index + 2)
        const waiter = this.lineWaiter
        this.lineWaiter = null
        waiter.resolve(line)
      }
      return
    }

    if (this.exactWaiter !== null) {
      if (this.buffer.length >= this.exactWaiter.count) {
        const value = this.buffer.subarray(0, this.exactWaiter.count)
        this.buffer = this.buffer.subarray(this.exactWaiter.count)
        const waiter = this.exactWaiter
        this.exactWaiter = null
        waiter.resolve(value)
      }
      return
    }

    if (this.terminatorWaiter !== null) {
      const index = this.buffer.indexOf(this.terminatorWaiter.terminator)
      if (index >= 0) {
        const value = this.buffer.subarray(0, index)
        this.buffer = this.buffer.subarray(index + this.terminatorWaiter.terminator.length)
        const waiter = this.terminatorWaiter
        this.terminatorWaiter = null
        waiter.resolve(value)
      }
    }
  }

  private fail(error: Error): void {
    if (this.failure === null) this.failure = error
    const line = this.lineWaiter
    const exact = this.exactWaiter
    const terminator = this.terminatorWaiter
    this.lineWaiter = null
    this.exactWaiter = null
    this.terminatorWaiter = null
    line?.reject(error)
    exact?.reject(error)
    terminator?.reject(error)
  }
}
