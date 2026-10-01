import type { Socket } from 'node:net'
import { createSecureContext, TLSSocket } from 'node:tls'
import { stripDotStuffing } from '../../src/smtp/dot-stuffing.js'
import { SocketReader } from './socket-reader.js'
import { startTcpServer, type TcpFixture } from './tcp.js'

const NUL = String.fromCharCode(0)
const DATA_TERMINATOR = Buffer.from('\r\n.\r\n')

export interface SmtpFixtureOptions {
  users?: Record<string, string>
  certificate?: { key: Buffer; cert: Buffer } | null
  failRecipients?: string[]
  sizeLimit?: number
  /** Commands the fixture accepts but never answers, simulating a stalled server. */
  silentCommands?: string[]
  /** Additional EHLO continuation lines for adversarial reply tests. */
  ehloExtraLines?: number
  /** Delay between EHLO reply lines for one-deadline tests. */
  ehloReplyDelayMs?: number
}

export interface ReceivedMessage {
  from: string
  recipients: string[]
  data: Buffer
}

export interface SmtpFixture extends TcpFixture {
  readonly messages: ReceivedMessage[]
  readonly authAttempts: number
  readonly dataAttempts: number
}

interface FixtureState {
  messages: ReceivedMessage[]
  authAttempts: number
  dataAttempts: number
}

export async function startSmtpFixture(options: SmtpFixtureOptions = {}): Promise<SmtpFixture> {
  const users = options.users ?? { 'alice@example.test': 'secret' }
  const sizeLimit = options.sizeLimit ?? 10_485_760
  const state: FixtureState = { messages: [], authAttempts: 0, dataAttempts: 0 }

  const tcp = await startTcpServer((socket) => {
    void handleConnection(socket, options, users, sizeLimit, state)
  })

  return {
    ...tcp,
    get messages() {
      return state.messages
    },
    get authAttempts() {
      return state.authAttempts
    },
    get dataAttempts() {
      return state.dataAttempts
    },
  }
}

async function handleConnection(
  initialSocket: Socket,
  options: SmtpFixtureOptions,
  users: Record<string, string>,
  sizeLimit: number,
  state: FixtureState,
): Promise<void> {
  let socket = initialSocket
  let reader = new SocketReader(socket)
  let tlsActive = false
  let currentFrom: string | null = null
  let currentRecipients: string[] = []

  socket.write('220 fixture ESMTP ready\r\n')

  try {
    for (;;) {
      const line = await reader.readLine()
      const commandIndex = line.indexOf(' ')
      const command = (commandIndex === -1 ? line : line.slice(0, commandIndex)).toUpperCase()
      const rest = commandIndex === -1 ? '' : line.slice(commandIndex + 1).trim()

      if (options.silentCommands?.includes(command) === true) {
        continue
      }

      if (command === 'EHLO' || command === 'HELO') {
        const reply = ['250-fixture']
        reply.push('250-8BITMIME')
        reply.push(`250-SIZE ${sizeLimit}`)
        if (!tlsActive && options.certificate) reply.push('250-STARTTLS')
        reply.push('250-AUTH PLAIN LOGIN')
        for (let index = 0; index < (options.ehloExtraLines ?? 0); index += 1) {
          reply.push(`250-extra-${index}`)
        }
        reply.push('250 PIPELINING')
        const delay = options.ehloReplyDelayMs ?? 0
        for (const [index, line] of reply.entries()) {
          const write = (): void => {
            socket.write(`${line}\r\n`)
          }
          if (delay === 0) write()
          else setTimeout(write, index * delay)
        }
        continue
      }

      if (command === 'STARTTLS') {
        if (!options.certificate) {
          socket.write('454 4.7.0 TLS not available\r\n')
          continue
        }
        socket.write('220 2.0.0 Ready to start TLS\r\n')
        reader.dispose()
        socket = new TLSSocket(socket, {
          isServer: true,
          secureContext: createSecureContext(options.certificate),
        })
        reader = new SocketReader(socket)
        tlsActive = true
        continue
      }

      if (command === 'AUTH') {
        state.authAttempts += 1
        const ok = await verifyAuth(rest, reader, users, socket)
        socket.write(
          ok
            ? '235 2.7.0 Authentication successful\r\n'
            : '535 5.7.8 Authentication credentials invalid\r\n',
        )
        continue
      }

      if (command === 'MAIL') {
        currentFrom = parsePath(rest, 'FROM:')
        socket.write('250 2.1.0 Ok\r\n')
        continue
      }

      if (command === 'RCPT') {
        const recipient = parsePath(rest, 'TO:')
        if (options.failRecipients?.includes(recipient) === true) {
          socket.write('550 5.1.1 No such recipient here\r\n')
          continue
        }
        currentRecipients.push(recipient)
        socket.write('250 2.1.5 Ok\r\n')
        continue
      }

      if (command === 'DATA') {
        state.dataAttempts += 1
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        const raw = await reader.readUntil(DATA_TERMINATOR)
        state.messages.push({
          from: currentFrom ?? '',
          recipients: [...currentRecipients],
          data: stripDotStuffing(raw),
        })
        currentFrom = null
        currentRecipients = []
        socket.write('250 2.0.0 Ok: queued as NAVIN-FIXTURE\r\n')
        continue
      }

      if (command === 'RSET') {
        currentFrom = null
        currentRecipients = []
        socket.write('250 2.0.0 Ok\r\n')
        continue
      }

      if (command === 'QUIT') {
        socket.write('221 2.0.0 Bye\r\n')
        socket.end()
        return
      }

      socket.write('500 5.5.2 Command unrecognized\r\n')
    }
  } catch {
    socket.destroy()
  }
}

async function verifyAuth(
  rest: string,
  reader: SocketReader,
  users: Record<string, string>,
  socket: Socket,
): Promise<boolean> {
  const mechanismIndex = rest.indexOf(' ')
  const mechanism = (mechanismIndex === -1 ? rest : rest.slice(0, mechanismIndex)).toUpperCase()
  const initial = mechanismIndex === -1 ? '' : rest.slice(mechanismIndex + 1).trim()

  if (mechanism === 'PLAIN') {
    let response = initial
    if (response === '') {
      socket.write('334 \r\n')
      response = (await reader.readLine()).trim()
    }
    const decoded = Buffer.from(response, 'base64').toString('utf8')
    const parts = decoded.split(NUL)
    const user = parts[1] ?? ''
    const password = parts[2] ?? ''
    return users[user] === password
  }

  if (mechanism === 'LOGIN') {
    socket.write(`334 ${Buffer.from('Username:').toString('base64')}\r\n`)
    const user = Buffer.from((await reader.readLine()).trim(), 'base64').toString('utf8')
    socket.write(`334 ${Buffer.from('Password:').toString('base64')}\r\n`)
    const password = Buffer.from((await reader.readLine()).trim(), 'base64').toString('utf8')
    return users[user] === password
  }

  return false
}

function parsePath(rest: string, prefix: string): string {
  const value = rest.slice(prefix.length).trim()
  const start = value.indexOf('<')
  const end = value.indexOf('>', start + 1)
  if (start >= 0 && end > start) return value.slice(start + 1, end)
  return value
}
