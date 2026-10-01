import { describe, expect, it } from 'vitest'
import { DEFAULT_PROTOCOL_LIMITS, type ProtocolLimits } from '../src/common/limits.js'
import { readImapResponse, type ImapResponseSource } from '../src/imap/parser.js'

/** A sequential in-memory byte source that mimics {@link BoundedConnection}. */
class FakeSource implements ImapResponseSource {
  readonly limits: ProtocolLimits
  private buffer: Buffer

  constructor(input: string, limits: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS) {
    this.buffer = Buffer.from(input, 'latin1')
    this.limits = limits
  }

  async readLine(): Promise<Buffer> {
    const index = this.buffer.indexOf('\r\n')
    if (index < 0) throw new Error('no CRLF in test input')
    const line = this.buffer.subarray(0, index)
    this.buffer = this.buffer.subarray(index + 2)
    return line
  }

  async readExact(count: number): Promise<Buffer> {
    const value = this.buffer.subarray(0, count)
    this.buffer = this.buffer.subarray(count)
    return value
  }
}

describe('IMAP response parser', () => {
  it('classifies an untagged CAPABILITY response', async () => {
    const response = await readImapResponse(new FakeSource('* CAPABILITY IMAP4rev1 STARTTLS\r\n'))
    expect(response.prefix.kind).toBe('untagged')
    expect(response.untagged).toBe('CAPABILITY')
    expect(response.rest).toBe('IMAP4rev1 STARTTLS')
  })

  it('classifies a tagged OK with trailing text', async () => {
    const response = await readImapResponse(new FakeSource('A0001 OK SELECT completed\r\n'))
    expect(response.prefix).toEqual({ kind: 'tagged', tag: 'A0001' })
    expect(response.status).toBe('OK')
    expect(response.rest).toBe('SELECT completed')
  })

  it('classifies a continuation', async () => {
    const response = await readImapResponse(new FakeSource('+ VXNlcm5hbWU6\r\n'))
    expect(response.prefix.kind).toBe('continuation')
    expect(response.rest).toBe('VXNlcm5hbWU6')
  })

  it('resolves an in-line literal and surfaces its bytes', async () => {
    const response = await readImapResponse(
      new FakeSource('* 1 FETCH (BODY[] {12}\r\nHello World!)\r\n'),
    )
    expect(response.untagged).toBe('FETCH')
    expect(response.literals).toHaveLength(1)
    expect(response.literals[0]?.toString()).toBe('Hello World!')
    expect(response.text).toBe('* 1 FETCH (BODY[] Hello World!)')
  })

  it('resolves multiple literals within one response', async () => {
    const response = await readImapResponse(
      new FakeSource('* 1 FETCH (A {2}\r\nhi B {2}\r\nyo)\r\n'),
    )
    expect(response.literals.map((literal) => literal.toString())).toEqual(['hi', 'yo'])
    expect(response.text).toBe('* 1 FETCH (A hi B yo)')
  })

  it('handles a non-synchronizing literal marker', async () => {
    const response = await readImapResponse(new FakeSource('* 1 FETCH (X {3+}\r\nabc)\r\n'))
    expect(response.literals[0]?.toString()).toBe('abc')
  })

  it('rejects a literal larger than the configured limit', async () => {
    const limits: ProtocolLimits = { ...DEFAULT_PROTOCOL_LIMITS, maxLiteralBytes: 4 }
    await expect(
      readImapResponse(new FakeSource('* 1 FETCH (BODY[] {12}\r\nHello World!)\r\n', limits)),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})
