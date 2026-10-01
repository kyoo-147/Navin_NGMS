import type { NavinTokens } from './schema.js'
import { toKebabCase } from './css.js'
import { formatJsValue } from './format.js'

export function generateTailwindTheme(tokens: NavinTokens): string {
  const colors: Record<string, string> = {}
  for (const key of Object.keys(tokens.color.light)) {
    const kebab = toKebabCase(key)
    colors[kebab] = `var(--${kebab})`
    if (kebab !== key) {
      colors[key] = `var(--${kebab})`
    }
  }

  const spacing: Record<string, string> = {}
  for (const [key, value] of Object.entries(tokens.spacing)) {
    spacing[key] = `var(--space-${key}, ${value}px)`
  }
  for (const [key, value] of Object.entries(tokens.layout)) {
    const kebab = toKebabCase(key)
    spacing[kebab] = `var(--${kebab}, ${value}px)`
  }

  const borderRadius: Record<string, string> = {}
  for (const [key, value] of Object.entries(tokens.radius)) {
    borderRadius[key] = `var(--radius-${key}, ${value}px)`
  }

  const maxWidth: Record<string, string> = {
    'content-max': `var(--content-max, ${tokens.layout.contentMax}px)`,
    'control-content-max': `var(--control-content-max, ${tokens.layout.controlContentMax}px)`,
  }

  const transitionDuration: Record<string, string> = {
    fast: `var(--motion-fast, ${tokens.motion.fast}ms)`,
    default: `var(--motion-default, ${tokens.motion.default}ms)`,
    slow: `var(--motion-slow, ${tokens.motion.slow}ms)`,
  }

  const transitionTimingFunction: Record<string, string> = {
    navin: `var(--motion-ease, ${tokens.motion.easing})`,
    ease: `var(--motion-ease, ${tokens.motion.easing})`,
  }

  const themeConfig = {
    extend: {
      colors,
      spacing,
      borderRadius,
      maxWidth,
      transitionDuration,
      transitionTimingFunction,
    },
  }

  const lines: string[] = [
    '/**',
    ' * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY.',
    ' * Generated from docs/design/navin-tokens.json',
    ' */',
    '',
    `export const tailwindTheme = ${formatJsValue(themeConfig)} as const`,
    '',
    'export default tailwindTheme',
    '',
  ]

  return lines.join('\n')
}
