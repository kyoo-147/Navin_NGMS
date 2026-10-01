import { describe, it, expect } from 'vitest'
import {
  sanitizeHtml,
  replaceCidImages,
  detectAndCollapseQuotes,
  detectSuspiciousLinks,
  extractAuthenticationHeaders,
  extractUnsubscribeInfo,
  exportEml,
  htmlToPlainText,
} from '../src/security/sanitizer.js'
import type { NormalizedEmail } from '@navin/mail-gateway'
import type { MailboxId, MessageId, ThreadId } from '@navin/contracts'

describe('HTML Sanitizer & Security', () => {
  it('strips script tags and dangerous event handlers', () => {
    const malicious = `
      <div>
        <h1>Welcome</h1>
        <script>alert("xss")</script>
        <img src="valid.png" onerror="alert('hack')" onload="doEvil()" />
        <a href="javascript:alert('click')">Click here</a>
        <iframe src="https://evil.invalid"></iframe>
      </div>
    `
    const result = sanitizeHtml(malicious)
    expect(result.sanitizedHtml).not.toContain('<script')
    expect(result.sanitizedHtml).not.toContain('alert("xss")')
    expect(result.sanitizedHtml).not.toContain('onerror=')
    expect(result.sanitizedHtml).not.toContain('onload=')
    expect(result.sanitizedHtml).not.toContain('javascript:')
    expect(result.sanitizedHtml).not.toContain('<iframe')
    expect(result.sanitizedHtml).toContain('<h1>Welcome</h1>')
  })

  it('parser-sanitizes and blocks remote images without retaining attacker URLs', () => {
    const html = `
      <p>Hello</p>
      <img src="https://tracker.invalid/pixel.gif" alt="tracker" />
      <img src="http://example.com/logo.png" />
    `
    const blocked = sanitizeHtml(html, { allowRemoteImages: false })
    expect(blocked.blockedRemoteImagesCount).toBe(2)
    expect(blocked.sanitizedHtml).not.toContain('tracker.invalid')
    expect(blocked.sanitizedHtml).not.toContain('example.com/logo.png')

    // Direct remote loads remain fail-closed until an authenticated image proxy exists.
    const allowed = sanitizeHtml(html, { allowRemoteImages: true })
    expect(allowed.blockedRemoteImagesCount).toBe(2)
    expect(allowed.sanitizedHtml).not.toContain('tracker.invalid')
  })

  it('replaces inline cid: image references with resolved URLs', () => {
    const html = '<p>Check photo:</p><img src="cid:photo1" />'
    const attachments = [
      {
        filename: 'photo1.png',
        mimeType: 'image/png',
        size: 1024,
        blobId: '/blob/photo-123',
        cid: 'photo1',
      },
    ]
    const resolved = replaceCidImages(html, attachments)
    expect(resolved).toContain('src="/blob/photo-123"')
    const malicious = replaceCidImages(html, [
      {
        filename: 'photo1.png',
        mimeType: 'image/png',
        size: 1024,
        cid: 'photo1',
        blobId: '/blob/x\" onerror=\"alert(1)',
      },
    ])
    expect(malicious).not.toContain('onerror')
    expect(malicious).not.toContain('<img')
  })

  it('detects and collapses quoted email history', () => {
    const html = `
      <div>This is my new reply.</div>
      <div class="gmail_quote">
        <div>On Wed, Oct 1, 2026, Alice wrote:</div>
        <blockquote>Original message text</blockquote>
      </div>
    `
    const { body, quote } = detectAndCollapseQuotes(html)
    expect(body).toBe('<div>This is my new reply.</div>')
    expect(quote).toContain('gmail_quote')
    expect(quote).toContain('Original message text')
  })

  it('detects suspicious links like domain mismatches and IP addresses', () => {
    const suspiciousHtml = `
      <p>Please log in to your account:</p>
      <a href="https://phish.invalid/login">https://paypal.com</a>
      <a href="http://192.0.2.1/admin">System Admin</a>
      <a href="https://legit.example.com">https://legit.example.com/dashboard</a>
    `
    const warnings = detectSuspiciousLinks(suspiciousHtml)
    expect(warnings).toHaveLength(2)
    expect(warnings.find((w) => w.reason === 'domain_mismatch')?.href).toBe(
      'https://phish.invalid/login',
    )
    expect(warnings.find((w) => w.reason === 'ip_address')?.href).toBe('http://192.0.2.1/admin')
  })

  it('extracts SPF, DKIM, and DMARC status from headers', () => {
    const headers = {
      'authentication-results':
        'mail.example.invalid; dkim=pass header.i=@example.com; spf=pass smtp.mailfrom=alice@example.com; dmarc=pass',
    }
    const status = extractAuthenticationHeaders(headers)
    expect(status.spf).toBe('pass')
    expect(status.dkim).toBe('pass')
    expect(status.dmarc).toBe('pass')
  })

  it('extracts unsubscribe information and supports EML export', () => {
    const headers = {
      'list-unsubscribe':
        '<mailto:unsub@example.com?subject=unsubscribe>, <https://example.com/unsub>',
      'list-unsubscribe-post': 'List-Unsubscribe=One-Click',
    }
    const unsub = extractUnsubscribeInfo(headers)
    expect(unsub?.oneClick).toBe(true)
    expect(unsub?.url).toBe('https://example.com/unsub')
    expect(unsub?.mailto).toBe('unsub@example.com?subject=unsubscribe')

    const email: NormalizedEmail = {
      id: 'msg-eml' as MessageId,
      threadId: 'th-1' as ThreadId,
      mailboxIds: ['mb-1' as MailboxId],
      keywords: [],
      isUnread: false,
      isStarred: false,
      isDraft: false,
      isAnswered: false,
      hasAttachment: false,
      size: 512,
      preview: 'Hello Alice',
      subject: 'Weekly Sync',
      from: [{ name: 'Bob', address: 'bob@example.com' }],
      to: [{ name: 'Alice', address: 'alice@example.com' }],
      cc: [],
      bcc: [],
      replyTo: [],
      sentAt: '2026-10-01T10:00:00.000Z',
      receivedAt: '2026-10-01T10:00:05.000Z',
      bodyText: 'Hello Alice, see you tomorrow.',
      bodyHtml: '<p>Hello Alice, see you tomorrow.</p>',
      attachments: [],
      messageId: ['<msg-eml@example.invalid>'],
      inReplyTo: null,
      references: null,
    }

    const eml = exportEml(email)
    expect(eml).toContain('From: "Bob" <bob@example.com>')
    expect(eml).toContain('To: "Alice" <alice@example.com>')
    expect(eml).toContain('Subject: Weekly Sync')
    expect(eml).toContain('Hello Alice, see you tomorrow.')

    expect(htmlToPlainText('<p>Line 1</p><p>Line 2 &amp; more</p>')).toBe('Line 1\n\nLine 2 & more')
  })
})
