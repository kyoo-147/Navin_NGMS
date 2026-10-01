import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]

const ALLOWED_ATTRIBUTES = {
  '*': ['class', 'dir', 'lang', 'title'],
  a: ['href', 'title', 'target', 'rel'],
  img: ['alt', 'height', 'src', 'title', 'width'],
}

const SANITIZE_OPTIONS: Parameters<typeof sanitizeHtml>[1] = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  disallowedTagsMode: 'completelyDiscard',
  allowedSchemes: ['http', 'https', 'mailto', 'cid'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto'],
    img: ['cid'],
  },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  allowVulnerableTags: false,
  transformTags: {
    a: (_tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, rel: 'noopener noreferrer' },
    }),
  },
}

/**
 * Parses and sanitizes untrusted email HTML with sanitize-html/htmlparser2.
 * Active content, CSS, forms, SVG/MathML, data URLs, remote images, srcset,
 * event handlers and non-approved protocols are discarded. Inline cid images
 * remain available; callers must still render the fragment in a sandboxed
 * document with a restrictive CSP as defense in depth.
 */
export function sanitizeEmailHtml(input: string): string {
  return sanitizeHtml(String(input), SANITIZE_OPTIONS)
}
