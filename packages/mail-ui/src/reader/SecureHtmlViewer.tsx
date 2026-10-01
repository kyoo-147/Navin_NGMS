import React, { useState } from 'react'
import type { MailAttachment } from '@navin/contracts'
import {
  sanitizeHtml,
  replaceCidImages,
  detectAndCollapseQuotes,
  detectSuspiciousLinks,
} from '@navin/mail-core'

export interface SecureHtmlViewerProps {
  html: string | null
  plainTextFallback: string | null
  attachments?: MailAttachment[]
}

export const SecureHtmlViewer: React.FC<SecureHtmlViewerProps> = ({
  html,
  plainTextFallback,
  attachments = [],
}) => {
  const [showQuotes, setShowQuotes] = useState(false)

  if (!html && !plainTextFallback) {
    return <div style={{ color: 'var(--navin-text-muted)' }}>(No content)</div>
  }

  if (!html) {
    return (
      <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: '1.6' }}>
        {plainTextFallback}
      </div>
    )
  }

  // 1. Sanitize HTML
  const { sanitizedHtml, blockedRemoteImagesCount } = sanitizeHtml(html)

  // 2. Replace CID images
  const cidResolvedHtml = replaceCidImages(sanitizedHtml, attachments)

  // 3. Detect suspicious links
  const suspiciousLinks = detectSuspiciousLinks(cidResolvedHtml)

  // 4. Split quoted content
  const { body, quote } = detectAndCollapseQuotes(cidResolvedHtml)

  return (
    <div className="mail-html-viewer" style={{ width: '100%' }}>
      {/* Remote image block banner */}
      {blockedRemoteImagesCount > 0 && (
        <div className="mail-security-banner info" role="status">
          <span>
            🛡️ {blockedRemoteImagesCount} remote image{blockedRemoteImagesCount === 1 ? '' : 's'}{' '}
            blocked to protect your privacy.
          </span>
          <span>Remote loading requires the protected image proxy, which is not available.</span>
        </div>
      )}

      {/* Suspicious link warning banner */}
      {suspiciousLinks.length > 0 && (
        <div className="mail-security-banner danger" role="alert">
          <div>
            <strong>⚠️ Security Warning:</strong> This message contains {suspiciousLinks.length}{' '}
            suspicious link{suspiciousLinks.length === 1 ? '' : 's'} (destination domain differs
            from link text).
          </div>
          <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', fontSize: '0.8rem' }}>
            {suspiciousLinks.map((w, idx) => (
              <li key={idx}>
                "{w.text}" points to <code>{w.href}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Body content */}
      <div
        className="mail-rendered-html"
        dangerouslySetInnerHTML={{ __html: body }}
        style={{ lineHeight: 1.6 }}
      />

      {/* Quoted content collapse */}
      {quote && (
        <div style={{ marginTop: '16px' }}>
          <button
            type="button"
            className="mail-quoted-toggle"
            onClick={() => setShowQuotes((prev) => !prev)}
            aria-expanded={showQuotes}
            aria-label={showQuotes ? 'Hide quoted text' : 'Show quoted text'}
          >
            {showQuotes ? '− Hide quoted text' : '••• Show quoted text'}
          </button>
          {showQuotes && (
            <div className="mail-quoted-content" dangerouslySetInnerHTML={{ __html: quote }} />
          )}
        </div>
      )}
    </div>
  )
}
