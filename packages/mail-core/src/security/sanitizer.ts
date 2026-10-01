import { sanitizeEmailHtml } from '@navin/mail-gateway'

import type { MailAttachment } from '@navin/contracts'
import type { NormalizedEmail } from '@navin/mail-gateway'

export interface SanitizeOptions {
  allowRemoteImages?: boolean
}

export interface SanitizeResult {
  sanitizedHtml: string
  blockedRemoteImagesCount: number
  hasExternalLinks: boolean
}

export interface SuspiciousLinkWarning {
  href: string
  text: string
  reason: 'domain_mismatch' | 'ip_address' | 'punycode' | 'unsafe_protocol'
}

export interface AuthenticationStatus {
  spf: 'pass' | 'fail' | 'none'
  dkim: 'pass' | 'fail' | 'none'
  dmarc: 'pass' | 'fail' | 'none'
  details?: string
}

export interface UnsubscribeInfo {
  mailto?: string
  url?: string
  oneClick: boolean
}

/**
 * Parses untrusted email HTML through the mail-gateway's strict htmlparser2
 * sanitizer. Remote images stay blocked even when an older caller supplies
 * allowRemoteImages; enabling them safely requires a separately authenticated
 * image proxy rather than inserting attacker-controlled URLs into the DOM.
 */
export function sanitizeHtml(html: string, _options: SanitizeOptions = {}): SanitizeResult {
  if (!html) {
    return { sanitizedHtml: '', blockedRemoteImagesCount: 0, hasExternalLinks: false }
  }

  const blockedRemoteImagesCount = Array.from(
    html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//gi),
  ).length
  const sanitizedHtml = sanitizeEmailHtml(html)

  return {
    sanitizedHtml,
    blockedRemoteImagesCount,
    hasExternalLinks: /href\s*=\s*["']https?:\/\//i.test(sanitizedHtml),
  }
}

/**
 * Replaces cid: attachment references with safe resolved URLs.
 */
export function replaceCidImages(
  html: string,
  attachments: readonly MailAttachment[],
  resolver?: (cid: string) => string | undefined,
): string {
  if (!html) return ''
  return html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    const srcMatch = attrs.match(/\bsrc\s*=\s*(["'])cid:(.*?)\1/i)
    if (!srcMatch) return match
    const cid = srcMatch[2]
    const resolvedUrl =
      resolver?.(cid) ?? attachments.find((a) => a.cid === cid || a.filename === cid)?.blobId
    if (!resolvedUrl || !isSafeResolvedImageUrl(resolvedUrl)) return ''
    return match.replace(srcMatch[0], `src="${escapeHtmlAttribute(resolvedUrl)}"`)
  })
}

function isSafeResolvedImageUrl(value: string): boolean {
  if (/\p{Cc}/u.test(value) || value.includes('\\') || value.includes('"') || value.includes("'")) {
    return false
  }
  return value.startsWith('/') && !value.startsWith('//')
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Detects quoted text in email HTML and splits the body into new message and quoted section.
 */
export function detectAndCollapseQuotes(html: string): { body: string; quote: string | null } {
  if (!html) return { body: '', quote: null }

  // Gmail quote marker
  const gmailQuoteIdx = html.search(/<div\b[^>]*class=["'][^"']*gmail_quote[^"']*["'][^>]*>/i)
  if (gmailQuoteIdx !== -1) {
    return {
      body: html.slice(0, gmailQuoteIdx).trim(),
      quote: html.slice(gmailQuoteIdx).trim(),
    }
  }

  // Blockquote marker
  const blockquoteIdx = html.search(/<blockquote\b[^>]*>/i)
  if (blockquoteIdx !== -1) {
    return {
      body: html.slice(0, blockquoteIdx).trim(),
      quote: html.slice(blockquoteIdx).trim(),
    }
  }

  // Plain text quote pattern inside HTML
  const onWroteIdx = html.search(/On\s+[A-Za-z0-9,:\s]+\s+wrote:/i)
  if (onWroteIdx !== -1) {
    return {
      body: html.slice(0, onWroteIdx).trim(),
      quote: html.slice(onWroteIdx).trim(),
    }
  }

  return { body: html, quote: null }
}

/**
 * Detects suspicious links (domain mismatch, IP address, punycode, etc.).
 */
export function detectSuspiciousLinks(html: string): SuspiciousLinkWarning[] {
  const warnings: SuspiciousLinkWarning[] = []
  const linkRegex = /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1] ?? ''
    const rawText = (match[2] ?? '').replace(/<[^>]*>/g, '').trim()

    // 1. IP address in href
    if (/^https?:\/\/(\d{1,3}\.){3}\d{1,3}/i.test(href)) {
      warnings.push({ href, text: rawText, reason: 'ip_address' })
      continue
    }

    // 2. Punycode in href
    if (/xn--/i.test(href)) {
      warnings.push({ href, text: rawText, reason: 'punycode' })
      continue
    }

    // 3. Domain mismatch: link text looks like a domain, but href is a different domain
    const cleanText = rawText
      .replace(/^https?:\/\//i, '')
      .replace(/[/?#].*$/, '')
      .trim()
    const textDomainMatch = cleanText.match(/^([a-z0-9-]+\.)+[a-z]{2,}/i)
    if (textDomainMatch) {
      const textDomain = textDomainMatch[0].toLowerCase()
      try {
        const parsedHref = new URL(href)
        const hrefHost = parsedHref.hostname.toLowerCase()
        if (textDomain !== hrefHost && !hrefHost.endsWith(`.${textDomain}`)) {
          warnings.push({ href, text: rawText, reason: 'domain_mismatch' })
          continue
        }
      } catch {
        // invalid URL
      }
    }
  }

  return warnings
}

/**
 * Extracts SPF, DKIM, and DMARC verification status from email headers.
 */
export function extractAuthenticationHeaders(
  headers: Record<string, string | string[]>,
): AuthenticationStatus {
  const status: AuthenticationStatus = { spf: 'none', dkim: 'none', dmarc: 'none' }

  const authResults = headers['authentication-results']
  const authStr = Array.isArray(authResults) ? authResults.join(' ') : (authResults ?? '')

  if (authStr) {
    status.details = authStr
    if (/spf=pass/i.test(authStr)) status.spf = 'pass'
    else if (/spf=fail/i.test(authStr)) status.spf = 'fail'

    if (/dkim=pass/i.test(authStr)) status.dkim = 'pass'
    else if (/dkim=fail/i.test(authStr)) status.dkim = 'fail'

    if (/dmarc=pass/i.test(authStr)) status.dmarc = 'pass'
    else if (/dmarc=fail/i.test(authStr)) status.dmarc = 'fail'
  }

  const receivedSpf = headers['received-spf']
  if (status.spf === 'none' && receivedSpf) {
    const spfStr = Array.isArray(receivedSpf) ? receivedSpf.join(' ') : receivedSpf
    if (/^pass/i.test(spfStr)) status.spf = 'pass'
    else if (/^fail/i.test(spfStr)) status.spf = 'fail'
  }

  return status
}

/**
 * Extracts one-click or mailto unsubscribe headers.
 */
export function extractUnsubscribeInfo(
  headers: Record<string, string | string[]>,
): UnsubscribeInfo | null {
  const listUnsub = headers['list-unsubscribe']
  if (!listUnsub) return null

  const unsubStr = Array.isArray(listUnsub) ? listUnsub.join(' ') : listUnsub
  const mailtoMatch = unsubStr.match(/<mailto:([^>]+)>/i)
  const urlMatch = unsubStr.match(/<(https?:[^>]+)>/i)

  const listUnsubPost = headers['list-unsubscribe-post']
  const oneClick = Boolean(
    listUnsubPost &&
    (Array.isArray(listUnsubPost) ? listUnsubPost.join(' ') : listUnsubPost).includes(
      'List-Unsubscribe=One-Click',
    ),
  )

  if (!mailtoMatch && !urlMatch) return null

  return {
    mailto: mailtoMatch ? mailtoMatch[1] : undefined,
    url: urlMatch ? urlMatch[1] : undefined,
    oneClick,
  }
}

/**
 * Converts HTML to readable plain text fallback.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

/**
 * Formats a NormalizedEmail into an RFC 5322 EML document.
 */
export function exportEml(email: NormalizedEmail): string {
  const lines: string[] = []
  const sender = email.from[0]
  lines.push(
    `From: ${sender?.name ? `"${sender.name}" <${sender.address}>` : (sender?.address ?? 'unknown')}`,
  )
  lines.push(
    `To: ${email.to.map((t) => (t.name ? `"${t.name}" <${t.address}>` : t.address)).join(', ')}`,
  )
  if (email.cc.length > 0) {
    lines.push(
      `Cc: ${email.cc.map((c) => (c.name ? `"${c.name}" <${c.address}>` : c.address)).join(', ')}`,
    )
  }
  lines.push(`Subject: ${email.subject}`)
  lines.push(`Date: ${new Date(email.receivedAt).toUTCString()}`)
  lines.push(`Message-ID: <${email.id}@example.invalid>`)
  lines.push('MIME-Version: 1.0')
  lines.push('Content-Type: text/plain; charset=utf-8')
  lines.push('')
  lines.push(email.bodyText || htmlToPlainText(email.bodyHtml ?? ''))
  return lines.join('\r\n')
}
