import { describe, it, expect } from 'vitest'
import {
  dotStuff,
  encodeDataBody,
  normalizeCrlf,
  prepareData,
  stripDotStuffing,
} from '../src/smtp/dot-stuffing.js'

describe('CRLF normalization', () => {
  it('normalizes LF and CR line endings to CRLF', () => {
    expect(normalizeCrlf('a\nb\rc\r\nd').toString()).toBe('a\r\nb\r\nc\r\nd')
  })

  it('leaves already-canonical CRLF untouched', () => {
    expect(normalizeCrlf('x\r\ny').toString()).toBe('x\r\ny')
  })
})

describe('dot-stuffing (RFC 5321 4.5.2)', () => {
  it('prefixes a dot to lines that begin with a dot', () => {
    expect(dotStuff('a\r\n.\r\n..b').toString()).toBe('a\r\n..\r\n...b')
  })

  it('stuffs a leading dot on the very first line', () => {
    expect(dotStuff('.hidden\r\nok').toString()).toBe('..hidden\r\nok')
  })

  it('round-trips through unstuffing', () => {
    const original = 'first\r\n.\r\nline\r\n..\r\nend'
    const stuffed = dotStuff(original)
    expect(stripDotStuffing(stuffed).toString()).toBe(normalizeCrlf(original).toString())
  })

  it('produces a DATA payload terminated by CRLF.CRLF', () => {
    const payload = prepareData('body line\r\n.leading dot')
    const text = payload.toString()
    expect(text.endsWith('\r\n.\r\n')).toBe(true)
    expect(text).toContain('..leading dot')
  })

  it('terminates an empty body correctly', () => {
    // Matches smtplib: an empty body is still terminated by CRLF.CRLF.
    expect(prepareData('').toString()).toBe('\r\n.\r\n')
  })

  it('ensures the body ends with CRLF before the terminator', () => {
    expect(encodeDataBody('no trailing newline').toString()).toBe('no trailing newline\r\n')
  })
})
