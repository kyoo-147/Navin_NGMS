import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { validateTokensSchema } from '../src/generator/schema.js'
import { generateTokensCss, toKebabCase } from '../src/generator/css.js'
import { generateTokensTs } from '../src/generator/ts.js'
import { generateTailwindTheme } from '../src/generator/tailwind.js'
import { tokens as currentTokens, cssVariables } from '../src/generated/tokens.js'
import { tailwindTheme } from '../src/generated/tailwind-theme.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Token Drift Tests', () => {
  const rootDir = path.resolve(__dirname, '../../..')
  const tokensJsonPath = path.join(rootDir, 'docs/design/navin-tokens.json')
  const tokensRefCssPath = path.join(rootDir, 'docs/design/navin-tokens.css')
  const generatedCssPath = path.resolve(__dirname, '../src/generated/tokens.css')
  const generatedTsPath = path.resolve(__dirname, '../src/generated/tokens.ts')
  const generatedTailwindPath = path.resolve(__dirname, '../src/generated/tailwind-theme.ts')

  const rawJson = JSON.parse(fs.readFileSync(tokensJsonPath, 'utf8'))
  const canonicalTokens = validateTokensSchema(rawJson)

  it('verifies that committed generated tokens.css matches fresh generation from canonical source', () => {
    const freshCss = generateTokensCss(canonicalTokens)
    const diskCss = fs.readFileSync(generatedCssPath, 'utf8')

    expect(diskCss).toBe(freshCss)
  })

  it('verifies that committed generated tokens.ts matches fresh generation from canonical source', () => {
    const freshTs = generateTokensTs(canonicalTokens)
    const diskTs = fs.readFileSync(generatedTsPath, 'utf8')

    expect(diskTs).toBe(freshTs)
  })

  it('verifies that committed generated tailwind-theme.ts matches fresh generation from canonical source', () => {
    const freshTailwind = generateTailwindTheme(canonicalTokens)
    const diskTailwind = fs.readFileSync(generatedTailwindPath, 'utf8')

    expect(diskTailwind).toBe(freshTailwind)
  })

  it('verifies zero drift between canonical navin-tokens.json and reference docs/design/navin-tokens.css', () => {
    const refCss = fs.readFileSync(tokensRefCssPath, 'utf8')

    // All light colors from JSON must exist in reference CSS with exact value
    for (const [key, value] of Object.entries(canonicalTokens.color.light)) {
      const varName = `--${toKebabCase(key)}`
      const expectedLine = `${varName}: ${value};`
      expect(refCss).toContain(expectedLine)
    }

    // All dark colors from JSON must exist in reference CSS with exact value
    for (const [key, value] of Object.entries(canonicalTokens.color.dark)) {
      const varName = `--${toKebabCase(key)}`
      const expectedLine = `${varName}: ${value};`
      expect(refCss).toContain(expectedLine)
    }

    // All spacing must match
    for (const [key, value] of Object.entries(canonicalTokens.spacing)) {
      expect(refCss).toContain(`--space-${key}: ${value}px;`)
    }

    // All radius must match
    for (const [key, value] of Object.entries(canonicalTokens.radius)) {
      expect(refCss).toContain(`--radius-${key}: ${value}px;`)
    }

    // All layout tokens must match
    for (const [key, value] of Object.entries(canonicalTokens.layout)) {
      expect(refCss).toContain(`--${toKebabCase(key)}: ${value}px;`)
    }

    // Motion tokens must match
    expect(refCss).toContain(`--motion-fast: ${canonicalTokens.motion.fast}ms;`)
    expect(refCss).toContain(`--motion-default: ${canonicalTokens.motion.default}ms;`)
    expect(refCss).toContain(`--motion-slow: ${canonicalTokens.motion.slow}ms;`)
    expect(refCss).toContain(`--motion-ease: ${canonicalTokens.motion.easing};`)
  })

  it('verifies generated TypeScript tokens match generated CSS variables in tokens.css', () => {
    const diskCss = fs.readFileSync(generatedCssPath, 'utf8')

    for (const key of Object.keys(currentTokens.color.light)) {
      const varName = `--${toKebabCase(key)}`
      expect(diskCss).toContain(varName)
      expect(cssVariables.color[key as keyof typeof cssVariables.color]).toBe(`var(${varName})`)
    }

    for (const key of Object.keys(currentTokens.spacing)) {
      expect(diskCss).toContain(`--space-${key}`)
      expect(cssVariables.spacing[key as keyof typeof cssVariables.spacing]).toBe(
        `var(--space-${key})`,
      )
    }

    for (const key of Object.keys(currentTokens.radius)) {
      expect(diskCss).toContain(`--radius-${key}`)
      expect(cssVariables.radius[key as keyof typeof cssVariables.radius]).toBe(
        `var(--radius-${key})`,
      )
    }

    for (const key of Object.keys(currentTokens.layout)) {
      const varName = `--${toKebabCase(key)}`
      expect(diskCss).toContain(varName)
      expect(cssVariables.layout[key as keyof typeof cssVariables.layout]).toBe(`var(${varName})`)
    }

    expect(diskCss).toContain('--motion-fast')
    expect(diskCss).toContain('--motion-default')
    expect(diskCss).toContain('--motion-slow')
    expect(diskCss).toContain('--motion-ease')
  })

  it('verifies that tailwindTheme incorporates all color and layout tokens', () => {
    for (const key of Object.keys(currentTokens.color.light)) {
      const kebab = toKebabCase(key)
      expect(tailwindTheme.extend.colors[kebab as keyof typeof tailwindTheme.extend.colors]).toBe(
        `var(--${kebab})`,
      )
    }

    for (const key of Object.keys(currentTokens.spacing)) {
      expect(tailwindTheme.extend.spacing[key as keyof typeof tailwindTheme.extend.spacing]).toBe(
        `var(--space-${key}, ${currentTokens.spacing[key as keyof typeof currentTokens.spacing]}px)`,
      )
    }

    for (const key of Object.keys(currentTokens.radius)) {
      expect(
        tailwindTheme.extend.borderRadius[key as keyof typeof tailwindTheme.extend.borderRadius],
      ).toBe(
        `var(--radius-${key}, ${currentTokens.radius[key as keyof typeof currentTokens.radius]}px)`,
      )
    }
  })
})
