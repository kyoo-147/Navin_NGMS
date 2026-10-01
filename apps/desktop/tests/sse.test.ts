import { describe, expect, it } from 'vitest'
import {
  MAX_SSE_BUFFER_BYTES,
  MAX_SSE_EVENT_BYTES,
  parseSseStream,
  SseBufferOverflowError,
} from '../src/shell/navind/sse'

describe('SSE parsing and resume', () => {
  it('parses a complete event and keeps the partial tail', () => {
    const buffer = 'event: setup\nid: 1\ndata: {"a":1}\n\ndata: partial'
    const result = parseSseStream(buffer)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ event: 'setup', id: '1', data: '{"a":1}' })
    expect(result.rest).toBe('data: partial')
    expect(result.lastEventId).toBe('1')
  })

  it('joins multi-line data and carries the last event id forward', () => {
    const result = parseSseStream('id: 7\ndata: line1\ndata: line2\n\n')
    expect(result.events[0]?.data).toBe('line1\nline2')
    expect(result.lastEventId).toBe('7')
  })

  it('resumes from the returned partial block without losing data', () => {
    const partial = parseSseStream('event: ping\ndata: {')
    expect(partial.events).toHaveLength(0)
    const complete = parseSseStream(`${partial.rest}"x":true}\n\n`, partial.lastEventId)
    expect(complete.events[0]?.event).toBe('ping')
    expect(complete.events[0]?.data).toBe('{"x":true}')
  })

  it('defaults the event name to message and propagates ids', () => {
    const result = parseSseStream('id: 5\ndata: a\n\ndata: b\n\n')
    expect(result.events[0]?.event).toBe('message')
    expect(result.events[1]?.id).toBe('5')
  })

  it('bounds event and partial-buffer bytes', () => {
    expect(() => parseSseStream(`data: ${'x'.repeat(MAX_SSE_EVENT_BYTES)}\n\n`)).toThrow(
      SseBufferOverflowError,
    )
    expect(() => parseSseStream('x'.repeat(MAX_SSE_EVENT_BYTES + 1))).toThrow(
      SseBufferOverflowError,
    )
    expect(() => parseSseStream('x'.repeat(MAX_SSE_BUFFER_BYTES + 1))).toThrow(
      SseBufferOverflowError,
    )
  })
})
