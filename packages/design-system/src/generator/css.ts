import type { NavinTokens } from './schema.js'

export function toKebabCase(str: string): string {
  return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase()
}

export function normalizeCssEasing(easing: string): string {
  return easing.replace(/(?<!\d)\.(\d+)/g, '0.$1').replace(/,\s*/g, ', ')
}

export function generateTokensCss(tokens: NavinTokens): string {
  const lines: string[] = [
    '/**',
    ' * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY.',
    ' * Generated from docs/design/navin-tokens.json',
    ' */',
    '',
    ':root {',
  ]

  // 1. Light colors
  for (const [key, value] of Object.entries(tokens.color.light)) {
    lines.push(`  --${toKebabCase(key)}: ${value.toLowerCase()};`)
  }
  lines.push('')

  // 2. Spacing
  const spacingKeys = Object.keys(tokens.spacing).sort((a, b) => Number(a) - Number(b))
  for (const key of spacingKeys) {
    lines.push(`  --space-${key}: ${tokens.spacing[key]}px;`)
  }
  lines.push('')

  // 3. Radius
  const radiusOrder = ['xs', 'sm', 'md', 'lg', 'xl']
  const radiusKeys = Object.keys(tokens.radius).sort((a, b) => {
    const idxA = radiusOrder.indexOf(a)
    const idxB = radiusOrder.indexOf(b)
    if (idxA !== -1 && idxB !== -1) return idxA - idxB
    return a.localeCompare(b)
  })
  for (const key of radiusKeys) {
    lines.push(`  --radius-${key}: ${tokens.radius[key]}px;`)
  }
  lines.push('')

  // 4. Layout
  const layoutKeys = [
    'sidebarWidth',
    'sidebarCollapsed',
    'headerHeight',
    'contentMax',
    'pagePadding',
    'mailSidebar',
    'mailRow',
    'mailToolbar',
    'mailAiDrawer',
    'controlSidebar',
    'controlHeader',
    'controlContentMax',
  ]
  for (const key of layoutKeys) {
    if (tokens.layout[key] !== undefined) {
      lines.push(`  --${toKebabCase(key)}: ${tokens.layout[key]}px;`)
    }
  }
  for (const key of Object.keys(tokens.layout).sort()) {
    if (!layoutKeys.includes(key)) {
      lines.push(`  --${toKebabCase(key)}: ${tokens.layout[key]}px;`)
    }
  }
  lines.push('')

  // 5. Motion
  const normalizedEasing = normalizeCssEasing(tokens.motion.easing)
  lines.push(`  --motion-fast: ${tokens.motion.fast}ms;`)
  lines.push(`  --motion-default: ${tokens.motion.default}ms;`)
  lines.push(`  --motion-slow: ${tokens.motion.slow}ms;`)
  lines.push(`  --motion-ease: ${normalizedEasing};`)
  lines.push(`  --motion-easing: ${normalizedEasing};`)

  lines.push('}')
  lines.push('')

  // 6. Dark colors theme override
  lines.push("[data-theme='dark'],")
  lines.push('.dark {')
  for (const [key, value] of Object.entries(tokens.color.dark)) {
    lines.push(`  --${toKebabCase(key)}: ${value.toLowerCase()};`)
  }
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}
