import { describe, it, expect } from 'vitest'
import { generateTokensCss } from '../src/generator/css.js'
import { generateTokensTs } from '../src/generator/ts.js'
import { generateTailwindTheme } from '../src/generator/tailwind.js'
import { validateTokensSchema } from '../src/generator/schema.js'
import fs from 'fs'
import { fileURLToPath } from 'node:url'
import { formatJsString, formatJsValue } from '../src/generator/format.js'
import { normalizeCssEasing } from '../src/generator/css.js'

describe('Token Generator Modules', () => {
  const tokensPath = fileURLToPath(
    new URL('../../../docs/design/navin-tokens.json', import.meta.url),
  )
  const rawTokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'))
  const tokens = validateTokensSchema(rawTokens)

  describe('generateTokensCss', () => {
    it('normalizes shorthand decimals without corrupting leading-zero decimals', () => {
      expect(normalizeCssEasing('cubic-bezier(.2,.8,.2,1)')).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
      expect(normalizeCssEasing('cubic-bezier(0.2, 0.8, 0.2, 1)')).toBe(
        'cubic-bezier(0.2, 0.8, 0.2, 1)',
      )
    })

    it('generates valid CSS with :root and dark mode theme overrides', () => {
      const css = generateTokensCss(tokens)

      expect(css).toContain(':root {')
      expect(css).toContain('--bg-app: #fafaf8;')
      expect(css).toContain('--bg-surface: #ffffff;')
      expect(css).toContain('--accent: #7bcb45;')
      expect(css).toContain('--space-1: 4px;')
      expect(css).toContain('--space-16: 64px;')
      expect(css).toContain('--radius-xs: 4px;')
      expect(css).toContain('--radius-xl: 12px;')
      expect(css).toContain('--sidebar-width: 224px;')
      expect(css).toContain('--content-max: 1440px;')
      expect(css).toContain('--motion-fast: 120ms;')
      expect(css).toContain('--motion-ease: cubic-bezier(0.2, 0.8, 0.2, 1);')

      expect(css).toContain("[data-theme='dark']")
      expect(css).toContain('--bg-app: #111210;')
      expect(css).toContain('--accent: #8ed95a;')
      expect(css).toContain('--accent-soft: #20331a;')
    })

    it('is completely deterministic across repeated calls', () => {
      const run1 = generateTokensCss(tokens)
      const run2 = generateTokensCss(tokens)
      expect(run1).toBe(run2)
    })
  })

  describe('generateTokensTs', () => {
    it('escapes generated string literals safely', () => {
      expect(formatJsString("line one\\line two\n'quoted'")).toBe(
        "'line one\\\\line two\\n\\'quoted\\''",
      )
      expect(formatJsValue('tab\tvalue')).toBe("'tab\\tvalue'")
    })

    it('generates valid TypeScript definitions and exports', () => {
      const ts = generateTokensTs(tokens)

      expect(ts).toContain('export const tokens =')
      expect(ts).toContain('export const cssVariables =')
      expect(ts).toContain('export type Tokens = typeof tokens')
      expect(ts).toContain("bgApp: '#FAFAF8'")
      expect(ts).toContain("bgApp: 'var(--bg-app)'")
    })

    it('is completely deterministic across repeated calls', () => {
      const run1 = generateTokensTs(tokens)
      const run2 = generateTokensTs(tokens)
      expect(run1).toBe(run2)
    })
  })

  describe('generateTailwindTheme', () => {
    it('generates Tailwind theme configuration with CSS variable mappings', () => {
      const tw = generateTailwindTheme(tokens)

      expect(tw).toContain('export const tailwindTheme = {')
      expect(tw).toContain('colors: {')
      expect(tw).toContain('spacing: {')
      expect(tw).toContain('borderRadius: {')
      expect(tw).toContain('transitionDuration: {')
      expect(tw).toContain('transitionTimingFunction: {')
      expect(tw).toContain('export default tailwindTheme')
    })

    it('is completely deterministic across repeated calls', () => {
      const run1 = generateTailwindTheme(tokens)
      const run2 = generateTailwindTheme(tokens)
      expect(run1).toBe(run2)
    })
  })
})
