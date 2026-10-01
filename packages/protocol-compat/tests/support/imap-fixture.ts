import type { Socket } from 'node:net'
import { createSecureContext, TLSSocket } from 'node:tls'
import { SocketReader } from './socket-reader.js'
import { startTcpServer, type TcpFixture } from './tcp.js'

const NUL = String.fromCharCode(0)

export interface ImapFixtureOptions {
  capabilities?: string[]
  users?: Record<string, string>
  /** When true, LOGIN is refused until STARTTLS has upgraded the connection. */
  requireTlsForLogin?: boolean
  certificate?: { key: Buffer; cert: Buffer } | null
  /** Commands the fixture accepts but never answers, simulating a stalled server. */
  silentCommands?: string[]
  /** Full greeting line (without CRLF); defaults to an OK with inline capabilities. */
  greeting?: string
}

export interface ImapFixture extends TcpFixture {
  readonly connections: number
  readonly loginAttempts: number
  readonly authAttempts: number
}

interface FixtureState {
  connections: number
  loginAttempts: number
  authAttempts: number
}

const DEFAULT_CAPABILITIES = ['IMAP4rev1', 'STARTTLS', 'AUTH=PLAIN', 'AUTH=LOGIN', 'LOGINDISABLED']

export async function startImapFixture(options: ImapFixtureOptions = {}): Promise<ImapFixture> {
  const capabilities = options.capabilities ?? DEFAULT_CAPABILITIES
  const users = options.users ?? { 'alice@example.test': 'secret' }
  const state: FixtureState = { connections: 0, loginAttempts: 0, authAttempts: 0 }

  const tcp = await startTcpServer((socket) => {
    state.connections += 1
    void handleConnection(socket, options, capabilities, users, state)
  })

  return {
    ...tcp,
    get connections() {
      return state.connections
    },
    get loginAttempts() {
      return state.loginAttempts
    },
    get authAttempts() {
      return state.authAttempts
    },
  }
}

async function handleConnection(
  initialSocket: Socket,
  options: ImapFixtureOptions,
  capabilities: string[],
  users: Record<string, string>,
  state: FixtureState,
): Promise<void> {
  let socket = initialSocket
  let reader = new SocketReader(socket)
  let authenticated = false
  let tlsActive = false

  const currentCapabilities = (): string[] =>
    tlsActive
      ? capabilities.filter((token) => token !== 'STARTTLS' && token !== 'LOGINDISABLED')
      : capabilities

  const greeting =
    options.greeting ?? `* OK [CAPABILITY ${currentCapabilities().join(' ')}] fixture ready`
  socket.write(`${greeting}\r\n`)

  try {
    for (;;) {
      const line = await reader.readLine()
      const spaceIndex = line.indexOf(' ')
      const tag = spaceIndex === -1 ? line : line.slice(0, spaceIndex)
      const remainder = spaceIndex === -1 ? '' : line.slice(spaceIndex + 1)
      const commandIndex = remainder.indexOf(' ')
      const command = (
        commandIndex === -1 ? remainder : remainder.slice(0, commandIndex)
      ).toUpperCase()
      const args = commandIndex === -1 ? '' : remainder.slice(commandIndex + 1)

      if (options.silentCommands?.includes(command) === true) {
        continue
      }

      if (command === 'CAPABILITY') {
        socket.write(
          `* CAPABILITY ${currentCapabilities().join(' ')}\r\n${tag} OK CAPABILITY completed\r\n`,
        )
        continue
      }

      if (command === 'STARTTLS') {
        if (!options.certificate) {
          socket.write(`${tag} NO STARTTLS unavailable\r\n`)
          continue
        }
        socket.write(`${tag} OK Begin TLS\r\n`)
        reader.dispose()
        socket = new TLSSocket(socket, {
          isServer: true,
          secureContext: createSecureContext(options.certificate),
        })
        reader = new SocketReader(socket)
        tlsActive = true
        continue
      }

      if (command === 'LOGIN') {
        state.loginAttempts += 1
        const [user, password] = parseTwoArguments(args)
        if (options.requireTlsForLogin === true && !tlsActive) {
          socket.write(`${tag} NO LOGIN disabled\r\n`)
          continue
        }
        if (users[user] === password) {
          authenticated = true
          socket.write(`${tag} OK LOGIN completed\r\n`)
        } else {
          socket.write(`${tag} NO LOGIN failed\r\n`)
        }
        continue
      }

      if (command === 'AUTHENTICATE') {
        state.authAttempts += 1
        const mechanismIndex = args.indexOf(' ')
        const mechanism = (
          mechanismIndex === -1 ? args : args.slice(0, mechanismIndex)
        ).toUpperCase()
        const initial = mechanismIndex === -1 ? null : args.slice(mechanismIndex + 1)
        const ok = await verifySasl(mechanism, initial, reader, users, socket)
        if (ok) {
          authenticated = true
          socket.write(`${tag} OK AUTHENTICATE completed\r\n`)
        } else {
          socket.write(`${tag} NO AUTHENTICATE failed\r\n`)
        }
        continue
      }

      if (command === 'NOOP') {
        socket.write(`${tag} OK NOOP completed\r\n`)
        continue
      }

      if (command === 'SELECT') {
        socket.write(
          authenticated
            ? `${tag} OK [READ-WRITE] SELECT completed\r\n`
            : `${tag} NO not authenticated\r\n`,
        )
        continue
      }

      if (command === 'LOGOUT') {
        socket.write(`* BYE fixture logging out\r\n${tag} OK LOGOUT completed\r\n`)
        socket.end()
        return
      }

      socket.write(`${tag} BAD unknown command ${command}\r\n`)
    }
  } catch {
    socket.destroy()
  }
}

async function verifySasl(
  mechanism: string,
  initial: string | null,
  reader: SocketReader,
  users: Record<string, string>,
  socket: Socket,
): Promise<boolean> {
  if (mechanism === 'PLAIN') {
    let response = initial
    if (response === null) {
      socket.write('+ \r\n')
      response = await reader.readLine()
    }
    const decoded = Buffer.from(response.trim(), 'base64').toString('utf8')
    const parts = decoded.split(NUL)
    const user = parts[1] ?? ''
    const password = parts[2] ?? ''
    return users[user] === password
  }

  if (mechanism === 'LOGIN') {
    socket.write(`+ ${Buffer.from('Username:').toString('base64')}\r\n`)
    const user = Buffer.from((await reader.readLine()).trim(), 'base64').toString('utf8')
    socket.write(`+ ${Buffer.from('Password:').toString('base64')}\r\n`)
    const password = Buffer.from((await reader.readLine()).trim(), 'base64').toString('utf8')
    return users[user] === password
  }

  return false
}

function parseTwoArguments(input: string): [string, string] {
  const values: string[] = []
  let index = 0
  while (index < input.length && values.length < 2) {
    while (input[index] === ' ') index += 1
    if (input[index] === '"') {
      index += 1
      let out = ''
      while (index < input.length && input[index] !== '"') {
        if (input[index] === '\\') index += 1
        out += input[index] ?? ''
        index += 1
      }
      index += 1
      values.push(out)
    } else {
      let out = ''
      while (index < input.length && input[index] !== ' ') {
        out += input[index] ?? ''
        index += 1
      }
      values.push(out)
    }
  }
  return [values[0] ?? '', values[1] ?? '']
}
