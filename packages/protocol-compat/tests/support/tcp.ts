import { once } from 'node:events'
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'

export interface TcpFixture {
  port: number
  server: Server
  close: () => Promise<void>
}

/** Starts a loopback-only TCP server on an ephemeral port. */
export async function startTcpServer(onConnection: (socket: Socket) => void): Promise<TcpFixture> {
  const server = createServer(onConnection)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
