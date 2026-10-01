import { describe, expect, it } from 'vitest'
import { parseDeepLink } from '../src/shell/adapters/deep-link'
import { DeepLinkRejectedError } from '../src/shell/errors'

describe('deep-link policy', () => {
  it('parses open-surface and oauth callbacks', () => {
    expect(parseDeepLink('navin://open/mail')).toEqual({ kind: 'open-surface', surface: 'mail' })
    expect(parseDeepLink('navin://open/control')).toEqual({
      kind: 'open-surface',
      surface: 'control',
    })
    expect(parseDeepLink('navin://oauth/callback?code=abc&state=xyz')).toEqual({
      kind: 'oauth-callback',
      code: 'abc',
      state: 'xyz',
    })
  })

  it('rejects untrusted hosts, schemes, traversal and injected params', () => {
    expect(() => parseDeepLink('https://evil.example/open/mail')).toThrow(DeepLinkRejectedError)
    expect(() => parseDeepLink('navin://open/../../etc/passwd')).toThrow(DeepLinkRejectedError)
    expect(() => parseDeepLink('navin://open/mail?next=https://evil.example')).toThrow(
      DeepLinkRejectedError,
    )
    expect(() => parseDeepLink('navin://oauth/callback?code=only')).toThrow(DeepLinkRejectedError)
    expect(() => parseDeepLink('navin://open/mail#frag')).toThrow(DeepLinkRejectedError)
  })
})
