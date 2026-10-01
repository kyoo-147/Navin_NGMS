import { afterEach, describe, expect, it } from 'vitest'
import type { Socket } from 'node:net'
import { BoundedConnection } from '../src/transport/connection.js'
import { startTcpServer, type TcpFixture } from './support/tcp.js'

const fixtures: TcpFixture[] = []
const connections: BoundedConnection[] = []

async function fixture(onConnection: (socket: Socket) => void): Promise<TcpFixture> {
  const created = await startTcpServer(onConnection)
  fixtures.push(created)
  return created
}

async function connect(
  port: number,
  limits?: Parameters<typeof BoundedConnection.connect>[0]['limits'],
): Promise<BoundedConnection> {
  const connection = await BoundedConnection.connect({ host: '127.0.0.1', port, limits })
  connections.push(connection)
  return connection
}

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.close()
  await Promise.all(fixtures.splice(0).map((entry) => entry.close()))
})

describe('BoundedConnection', () => {
  it('reassembles a line split across chunks', async () => {
    const server = await fixture((socket) => {
      socket.write('HE')
      setTimeout(() => socket.write('LLO\r\nWORLD\r\n'), 10)
    })
    const connection = await connect(server.port)
    expect((await connection.readLine()).toString()).toBe('HELLO')
    expect((await connection.readLine()).toString()).toBe('WORLD')
  })

  it('reads an exact byte count across chunks', async () => {
    const server = await fixture((socket) => {
      socket.write('AB')
      setTimeout(() => socket.write('CDEF\r\n'), 10)
    })
    const connection = await connect(server.port)
    expect((await connection.readExact(6)).toString()).toBe('ABCDEF')
  })

  it('round-trips a written line', async () => {
    const server = await fixture((socket) => {
      socket.on('data', (chunk) => socket.write(chunk))
    })
    const connection = await connect(server.port)
    await connection.writeLine('PING')
    expect((await connection.readLine()).toString()).toBe('PING')
  })

  it('enforces the maximum line length', async () => {
    const server = await fixture((socket) => {
      socket.write('x'.repeat(256))
    })
    const connection = await connect(server.port, { maxLineBytes: 32 })
    await expect(connection.readLine()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(connection.isClosed).toBe(true)
  })

  it('times out a stalled read and closes the connection', async () => {
    const server = await fixture(() => {
      // Accept the connection but never send anything.
    })
    const connection = await connect(server.port)
    await expect(connection.readLine({ timeoutMs: 60 })).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(connection.isClosed).toBe(true)
  })

  it('honors an external abort signal', async () => {
    const server = await fixture(() => {})
    const connection = await connect(server.port)
    const controller = new AbortController()
    const pending = connection.readLine({ signal: controller.signal, timeoutMs: 5000 })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('surfaces connection refusal as CONNECT_FAILED', async () => {
    const server = await startTcpServer(() => {})
    const port = server.port
    await server.close()
    await expect(BoundedConnection.connect({ host: '127.0.0.1', port })).rejects.toMatchObject({
      code: 'CONNECT_FAILED',
    })
  })
})
