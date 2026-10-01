import { describe, expect, it } from 'vitest'
import { createSseParser } from '../src/sse.js'

describe('SSE parser', () => {
  it('parses fields, multi-line data, comments and event names', () => {
    const parser = createSseParser()
    const messages = parser.push(
      ': keep-alive comment\n' +
        'event: job.progress\n' +
        'id: evt_1\n' +
        'data: line one\n' +
        'data: line two\n' +
        '\n',
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]?.event).toBe('job.progress')
    expect(messages[0]?.id).toBe('evt_1')
    expect(messages[0]?.data).toBe('line one\nline two')
  })

  it('normalizes CRLF and CR line endings', () => {
    const parser = createSseParser()
    const messages = parser.push('data: a\r\ndata: b\r\r\ndata: c\n\n')
    expect(messages.map((message) => message.data)).toEqual(['a\nb', 'c'])
  })

  it('persists the last event id across events and keeps the default event name', () => {
    const parser = createSseParser()
    const first = parser.push('id: 7\ndata: one\n\n')
    const second = parser.push('data: two\n\n')
    expect(first[0]?.id).toBe('7')
    expect(first[0]?.event).toBe('message')
    expect(second[0]?.id).toBe('7')
  })

  it('parses retry fields and ignores malformed values', () => {
    const parser = createSseParser()
    const messages = parser.push('retry: 1500\ndata: x\n\nretry: soon\ndata: y\n\n')
    expect(messages[0]?.retry).toBe(1500)
    expect(messages[1]?.retry).toBeUndefined()
  })

  it('handles events split across chunk boundaries', () => {
    const parser = createSseParser()
    expect(parser.push('da')).toEqual([])
    expect(parser.push('ta: partial\n')).toEqual([])
    const messages = parser.push('\n')
    expect(messages[0]?.data).toBe('partial')
  })
})
