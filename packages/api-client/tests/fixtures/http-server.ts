import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  url: string
  path: string
  query: URLSearchParams
  headers: IncomingMessage['headers']
  body: string
  json<T = unknown>(): T
}

export type FixtureHandler = (
  request: RecordedRequest,
  response: ServerResponse,
) => void | Promise<void>

export interface HttpFixture {
  baseUrl: string
  requests: RecordedRequest[]
  requestsFor(path: string): RecordedRequest[]
  close(): Promise<void>
}

/**
 * Minimal real HTTP server bound to an ephemeral localhost port. Tests hit it through the actual
 * fetch transport, so HTTP framing, headers and streaming are exercised for real.
 */
export async function startHttpFixture(handler: FixtureHandler): Promise<HttpFixture> {
  const requests: RecordedRequest[] = []
  const server = createServer((req, res) => {
    req.on('error', () => undefined)
    res.on('error', () => undefined)
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const rawUrl = req.url ?? '/'
      const parsed = new URL(rawUrl, 'http://127.0.0.1')
      const body = Buffer.concat(chunks).toString('utf8')
      const record: RecordedRequest = {
        method: req.method ?? 'GET',
        url: rawUrl,
        path: parsed.pathname,
        query: parsed.searchParams,
        headers: req.headers,
        body,
        json: <T>() => (body.length > 0 ? (JSON.parse(body) as T) : (undefined as T)),
      }
      requests.push(record)
      Promise.resolve(handler(record, res)).catch((error: unknown) => {
        if (!res.headersSent) res.statusCode = 500
        if (!res.writableEnded) res.end(String(error))
      })
    })
  })
  server.on('clientError', (_error, socket) => socket.destroy())
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    requestsFor: (path: string) => requests.filter((request) => request.path === path),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded || response.destroyed) return
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

export interface SseEventInput {
  id?: string
  event?: string
  data: string
  retry?: number
}

export function openSse(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  response.flushHeaders()
  response.socket?.setNoDelay(true)
}

export function writeSseEvent(response: ServerResponse, event: SseEventInput): void {
  if (response.writableEnded || response.destroyed) return
  if (event.retry !== undefined) response.write(`retry: ${event.retry}\n`)
  if (event.id !== undefined) response.write(`id: ${event.id}\n`)
  if (event.event !== undefined) response.write(`event: ${event.event}\n`)
  for (const line of event.data.split('\n')) response.write(`data: ${line}\n`)
  response.write('\n')
}

export function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
