import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { MAX_PASSWORD_INPUT_BYTES, readPasswordLine } from '../src/password-stdin.js'

function streamOf(chunks: Array<string | Buffer>): Readable {
  return Readable.from(
    chunks.map((chunk) => (typeof chunk === 'string' ? Buffer.from(chunk) : chunk)),
  )
}

describe('readPasswordLine', () => {
  it('reads exactly one line and strips only a trailing LF', async () => {
    await expect(readPasswordLine(streamOf(['correct horse\n']))).resolves.toBe('correct horse')
  })

  it('strips only the CRLF terminator and preserves every other byte', async () => {
    await expect(readPasswordLine(streamOf(['p@ss word  \r\n']))).resolves.toBe('p@ss word  ')
  })

  it('stops at the first line terminator and ignores anything after it', async () => {
    await expect(readPasswordLine(streamOf(['secret\nGARBAGE']))).resolves.toBe('secret')
  })

  it('preserves a lone carriage return when there is no line terminator', async () => {
    await expect(readPasswordLine(streamOf(['abc\r']))).resolves.toBe('abc\r')
  })

  it('rejects input that exceeds the bounded maximum', async () => {
    const oversized = Buffer.alloc(MAX_PASSWORD_INPUT_BYTES + 1, 0x41)
    await expect(readPasswordLine(streamOf([oversized]))).rejects.toThrow(
      'Password input exceeds the maximum length',
    )
  })

  it('returns the first line even when oversized trailing data shares the same chunk', async () => {
    const chunk = Buffer.concat([
      Buffer.from('valid-password\n'),
      Buffer.alloc(MAX_PASSWORD_INPUT_BYTES + 1, 0x41),
    ])
    await expect(readPasswordLine(streamOf([chunk]))).resolves.toBe('valid-password')
  })

  it('rejects a first line that is itself over the bound', async () => {
    const chunk = Buffer.concat([
      Buffer.alloc(MAX_PASSWORD_INPUT_BYTES + 1, 0x41),
      Buffer.from('\n'),
    ])
    await expect(readPasswordLine(streamOf([chunk]))).rejects.toThrow(
      'Password input exceeds the maximum length',
    )
  })
})
