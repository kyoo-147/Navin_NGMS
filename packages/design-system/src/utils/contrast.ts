/**
 * WCAG 2.1 Relative Luminance and Contrast Ratio calculation
 * Specification: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */

export function hexToLinearRgb(hex: string): [number, number, number] {
  if (!/^#?[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Invalid 6-digit hex color: ${hex}`)
  }
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255

  return [
    r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4),
    g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4),
    b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4),
  ]
}

export function calculateRelativeLuminance(hex: string): number {
  const [r, g, b] = hexToLinearRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function calculateContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = calculateRelativeLuminance(foregroundHex)
  const l2 = calculateRelativeLuminance(backgroundHex)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export interface WcagEvaluation {
  ratio: number
  passesAA: boolean // >= 4.5:1
  passesAALarge: boolean // >= 3.0:1
  passesAAA: boolean // >= 7.0:1
  passesAAALarge: boolean // >= 4.5:1
}

export function evaluateWcagContrast(foregroundHex: string, backgroundHex: string): WcagEvaluation {
  const ratio = calculateContrastRatio(foregroundHex, backgroundHex)
  return {
    ratio,
    passesAA: ratio >= 4.5,
    passesAALarge: ratio >= 3.0,
    passesAAA: ratio >= 7.0,
    passesAAALarge: ratio >= 4.5,
  }
}
