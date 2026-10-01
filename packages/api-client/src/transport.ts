import { ApiNetworkError } from './errors.js'

export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Fetch credentials mode, declared locally so the client does not depend on the DOM lib. */
export type RequestCredentials = 'omit' | 'same-origin' | 'include'

export interface TransportRequest {
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
  credentials?: RequestCredentials
}

export interface TransportResponse {
  status: number
  ok: boolean
  headers: Headers
  text(): Promise<string>
  /** Raw byte stream for SSE and other long-lived responses. */
  body: ReadableStream<Uint8Array> | null
}

export interface HttpTransport {
  send(request: TransportRequest): Promise<TransportResponse>
}

/**
 * Real `fetch` transport. Streaming responses are exposed untouched so the SSE layer can consume
 * them incrementally.
 */
export class FetchTransport implements HttpTransport {
  private readonly fetchImpl: typeof fetch

  constructor(fetchImpl?: typeof fetch) {
    const impl = fetchImpl ?? globalThis.fetch
    if (typeof impl !== 'function') {
      throw new ApiNetworkError('No fetch implementation is available in this environment')
    }
    this.fetchImpl = impl.bind(globalThis)
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
      signal: request.signal,
    }
    if (request.body !== undefined) init.body = request.body
    if (request.credentials !== undefined) init.credentials = request.credentials
    const response = await this.fetchImpl(request.url, init)
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      text: () => response.text(),
      body: response.body as unknown as ReadableStream<Uint8Array> | null,
    }
  }
}
