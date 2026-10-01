export const MAX_SSE_EVENT_BYTES = 256 * 1024
export const MAX_SSE_BUFFER_BYTES = 1024 * 1024

export class SseBufferOverflowError extends Error {
  constructor(limit: number) {
    super(`SSE input exceeded the ${limit}-byte safety limit`)
    this.name = 'SseBufferOverflowError'
  }
}

export interface SseEvent {
  readonly id: string | null
  readonly event: string
  readonly data: string
  readonly retry: number | null
}

export interface SseParseResult {
  readonly events: readonly SseEvent[]
  readonly rest: string
  readonly lastEventId: string | null
}

const encoder = new TextEncoder()

function byteLength(value: string): number {
  return encoder.encode(value).byteLength
}

function assertWithin(value: string, limit: number): void {
  if (byteLength(value) > limit) throw new SseBufferOverflowError(limit)
}

function parseEventBlock(block: string): SseEvent | null {
  assertWithin(block, MAX_SSE_EVENT_BYTES)

  let event = 'message'
  let retry: number | null = null
  let id: string | null = null
  const dataLines: string[] = []

  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    switch (field) {
      case 'event':
        event = value
        break
      case 'data':
        dataLines.push(value)
        break
      case 'id':
        id = value
        break
      case 'retry': {
        const parsed = Number.parseInt(value, 10)
        if (Number.isFinite(parsed)) retry = parsed
        break
      }
      default:
        break
    }
  }

  if (dataLines.length === 0) return null
  return { id, event, data: dataLines.join('\n'), retry }
}

/**
 * Incremental SSE parser. Complete events are individually bounded and the
 * trailing partial event has a separate bound. Overflow is a protocol error;
 * callers must close the stream rather than retaining attacker-controlled data.
 */
export function parseSseStream(buffer: string, lastEventId: string | null = null): SseParseResult {
  const normalized = buffer.replace(/\r\n?/gu, '\n')
  assertWithin(normalized, MAX_SSE_BUFFER_BYTES)
  const events: SseEvent[] = []
  let cursor = 0
  let currentId = lastEventId

  for (;;) {
    const boundary = normalized.indexOf('\n\n', cursor)
    if (boundary === -1) break
    const block = normalized.slice(cursor, boundary)
    cursor = boundary + 2
    const parsed = parseEventBlock(block)
    if (parsed === null) continue
    if (parsed.id !== null) currentId = parsed.id
    events.push(parsed.id === null ? { ...parsed, id: currentId } : parsed)
  }

  const rest = normalized.slice(cursor)
  assertWithin(rest, MAX_SSE_EVENT_BYTES)
  return { events, rest, lastEventId: currentId }
}
