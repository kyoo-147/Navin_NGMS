import { baseUrlOf, parseNavindEndpoint, type NavindEndpoint } from './endpoint'
import { parseSseStream, SseBufferOverflowError, type SseEvent } from './sse'

export interface NavindClientOptions {
  readonly endpoint: string
  readonly fetchImpl?: typeof fetch
  readonly reconnectBaseMs?: number
  readonly reconnectMaxMs?: number
}

export interface NavindStreamHandlers {
  onOpen?: () => void
  onEvent: (event: SseEvent) => void
  onError?: (error: unknown) => void
}

export interface NavindStreamHandle {
  stop(): void
}

/**
 * Thin navind connectivity helper. It validates the endpoint through the shared
 * policy, then keeps an SSE stream alive with exponential-backoff reconnect and
 * `Last-Event-ID` resume. It contains no mail or control domain logic.
 */
export class NavindClient {
  readonly endpoint: NavindEndpoint
  private readonly fetchImpl: typeof fetch
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number

  constructor(options: NavindClientOptions) {
    this.endpoint = parseNavindEndpoint(options.endpoint)
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1000
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30000
  }

  eventsUrl(): string {
    return `${baseUrlOf(this.endpoint)}/api/v1/events`
  }

  openEvents(handlers: NavindStreamHandlers): NavindStreamHandle {
    const abort = new AbortController()
    let stopped = false
    let lastEventId: string | null = null
    let attempt = 0

    const connect = async (): Promise<void> => {
      while (!stopped) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
        try {
          const headers: Record<string, string> = { accept: 'text/event-stream' }
          if (lastEventId !== null) headers['Last-Event-ID'] = lastEventId

          const response = await this.fetchImpl(this.eventsUrl(), {
            headers,
            signal: abort.signal,
          })
          if (!response.ok || response.body === null) {
            throw new Error(`navind events stream failed with status ${response.status}`)
          }

          attempt = 0
          handlers.onOpen?.()

          reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            buffer += decoder.decode(chunk.value, { stream: true })
            const parsed = parseSseStream(buffer, lastEventId)
            buffer = parsed.rest
            lastEventId = parsed.lastEventId
            for (const event of parsed.events) handlers.onEvent(event)
          }
          reader = null
        } catch (error) {
          if (reader !== null) {
            await reader.cancel().catch(() => undefined)
            reader = null
          }
          if (stopped || abort.signal.aborted) return
          handlers.onError?.(error)
          if (error instanceof SseBufferOverflowError) {
            // A bounded parser overflow is a protocol violation. Close this
            // stream permanently instead of reconnecting into the same attack.
            stopped = true
            abort.abort()
            return
          }
        }

        if (stopped) return
        attempt += 1
        const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** (attempt - 1))
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    void connect()
    return {
      stop: () => {
        stopped = true
        abort.abort()
      },
    }
  }
}
