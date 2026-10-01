import { describe, expect, it } from 'vitest'
import { readSmtpReply, type SmtpReplySource } from '../src/smtp/parser.js'

class FakeLineSource implements SmtpReplySource {
  constructor(private lines: string[]) {}

  async readLine(): Promise<Buffer> {
    const next = this.lines.shift()
    if (next === undefined) throw new Error('no more test lines')
    return Buffer.from(next, 'latin1')
  }
}

describe('SMTP reply parser', () => {
  it('parses a single-line reply', async () => {
    const reply = await readSmtpReply(new FakeLineSource(['250 2.1.0 Ok']))
    expect(reply.code).toBe(250)
    expect(reply.lines).toEqual(['2.1.0 Ok'])
  })

  it('parses a multiline EHLO reply', async () => {
    const reply = await readSmtpReply(
      new FakeLineSource(['250-fixture', '250-STARTTLS', '250 AUTH PLAIN LOGIN']),
    )
    expect(reply.code).toBe(250)
    expect(reply.lines).toEqual(['fixture', 'STARTTLS', 'AUTH PLAIN LOGIN'])
  })

  it('parses a 354 DATA prompt', async () => {
    const reply = await readSmtpReply(new FakeLineSource(['354 End data with <CR><LF>.<CR><LF>']))
    expect(reply.code).toBe(354)
  })

  it('rejects inconsistent continuation codes', async () => {
    await expect(readSmtpReply(new FakeLineSource(['250-start', '251 end']))).rejects.toMatchObject(
      {
        code: 'UNEXPECTED_RESPONSE',
      },
    )
  })

  it('rejects a malformed reply line', async () => {
    await expect(readSmtpReply(new FakeLineSource(['not a reply']))).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
    })
  })
})
