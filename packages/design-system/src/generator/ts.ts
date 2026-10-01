import type { NavinTokens } from './schema.js'
import { toKebabCase } from './css.js'
import { formatJsValue } from './format.js'

interface CssVariableGroups {
  color: Record<string, string>
  spacing: Record<string, string>
  radius: Record<string, string>
  layout: Record<string, string>
  motion: Record<string, string>
}

export function generateTokensTs(tokens: NavinTokens): string {
  // Build cssVariables map
  const cssVariables: CssVariableGroups = {
    color: {},
    spacing: {},
    radius: {},
    layout: {},
    motion: {},
  }

  // Color variables (pointing to CSS variable names)
  for (const key of Object.keys(tokens.color.light)) {
    cssVariables.color[key] = `var(--${toKebabCase(key)})`
  }

  // Spacing variables
  for (const key of Object.keys(tokens.spacing)) {
    cssVariables.spacing[key] = `var(--space-${key})`
  }

  // Radius variables
  for (const key of Object.keys(tokens.radius)) {
    cssVariables.radius[key] = `var(--radius-${key})`
  }

  // Layout variables
  for (const key of Object.keys(tokens.layout)) {
    cssVariables.layout[key] = `var(--${toKebabCase(key)})`
  }

  // Motion variables
  cssVariables.motion.fast = 'var(--motion-fast)'
  cssVariables.motion.default = 'var(--motion-default)'
  cssVariables.motion.slow = 'var(--motion-slow)'
  cssVariables.motion.ease = 'var(--motion-ease)'
  cssVariables.motion.easing = 'var(--motion-easing)'

  const lines: string[] = [
    '/**',
    ' * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY.',
    ' * Generated from docs/design/navin-tokens.json',
    ' */',
    '',
    `export const tokens = ${formatJsValue(tokens)} as const`,
    '',
    `export const cssVariables = ${formatJsValue(cssVariables)} as const`,
    '',
    'export type Tokens = typeof tokens',
    'export type LightColorToken = keyof typeof tokens.color.light',
    'export type DarkColorToken = keyof typeof tokens.color.dark',
    'export type SpacingToken = keyof typeof tokens.spacing',
    'export type RadiusToken = keyof typeof tokens.radius',
    'export type LayoutToken = keyof typeof tokens.layout',
    'export type MotionToken = keyof typeof tokens.motion',
    '',
    'export default tokens',
    '',
  ]

  return lines.join('\n')
}
