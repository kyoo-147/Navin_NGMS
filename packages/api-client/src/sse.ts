import type { Static, TSchema } from '@sinclair/typebox'
import { utf8ByteLength } from './body.js'
import { ApiSseError, type ApiClientError } from './errors.js'
import type { QueryParams } from './query.js'
import type { RetryPolicy } from './retry.js'

export interface SseMessage {
  id?: string
  event: string
  data: string
  retry?: number
}

export interface SseParser {
  push(chunk: string): SseMessage[]
}

/**
 * Incremental Server-Sent Events parser implementing the WHATWG event-stream rules: CRLF/CR/LF
 * normalization, multi-line `data`, comment lines, `event`, `id` and `retry` fields. Event ids
 * persist across events so the caller can resume with `Last-Event-ID`.
 */
export function createSseParser(maxEventBytes: number = Number.POSITIVE_INFINITY): SseParser {
  let buffer = ''
  let eventBytes = 0
  let dataLines: string[] = []
  let eventName = ''
  let lastEventId: string | undefined
  let pendingRetry: number | undefined

  const resetEvent = (): void => {
    eventBytes = 0
    dataLines = []
    eventName = ''
    pendingRetry = undefined
  }

  const takePending = (): SseMessage[] => {
    if (dataLines.length === 0) {
      eventBytes = 0
      eventName = ''
      pendingRetry = undefined
      return []
    }
    const message: SseMessage = {
      event: eventName.length > 0 ? eventName : 'message',
      data: dataLines.join('\n'),
    }
    if (lastEventId !== undefined) message.id = lastEventId
    if (pendingRetry !== undefined) message.retry = pendingRetry
    resetEvent()
    return [message]
  }

  const processLine = (line: string, out: SseMessage[]): void => {
    if (line.length === 0) {
      out.push(...takePending())
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'data':
        dataLines.push(value)
        break
      case 'event':
        eventName = value
        break
      case 'id':
        if (!value.includes('\u0000')) lastEventId = value
        break
      case 'retry':
        if (/^\d+$/.test(value)) pendingRetry = Number(value)
        break
      default:
        break
    }
  }

  const rejectOversized = (): never => {
    resetEvent()
    buffer = ''
    throw new ApiSseError(`SSE event exceeded the ${maxEventBytes} byte limit`)
  }

  return {
    push(chunk: string): SseMessage[] {
      buffer += chunk.replace(/\r\n?/g, '\n')
      const out: SseMessage[] = []
      for (;;) {
        const newlineIndex = buffer.indexOf('\n')
        if (newlineIndex === -1) {
          if (utf8ByteLength(buffer) + eventBytes > maxEventBytes) rejectOversized()
          break
        }
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        eventBytes += utf8ByteLength(line) + 1
        if (eventBytes > maxEventBytes) rejectOversized()
        processLine(line, out)
      }
      return out
    },
  }
}

export interface SseOpenInfo {
  status: number
  headers: Headers
}

export interface SseEvent<T> {
  id?: string
  event: string
  data: T
}

export interface SseRequestOptions<T extends TSchema> {
  path: string
  schema: T
  query?: QueryParams
  lastEventId?: string
  signal?: AbortSignal
  headers?: Record<string, string>
  retry?: Partial<RetryPolicy> | false
  onEvent?: (event: SseEvent<Static<T>>) => void
  onError?: (error: ApiClientError) => void
  onOpen?: (info: SseOpenInfo) => void
  onClose?: () => void
  /** Optional terminal-event hook. Returning true stops reconnecting after the event is handled. */
  isComplete?: (event: SseEvent<Static<T>>) => boolean
}

export interface SseSubscription {
  close(): void
  readonly closed: boolean
  readonly lastEventId: string | undefined
  readonly done: Promise<void>
}
