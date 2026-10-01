import { describe, it, expect } from 'vitest'
import {
  calculateContrastRatio,
  evaluateWcagContrast,
  hexToLinearRgb,
} from '../src/utils/contrast.js'
import { tokens } from '../src/generated/tokens.js'

describe('WCAG 2.1 Contrast Tests for Documented Pairs', () => {
  it('validates hex input and exposes linearized RGB explicitly', () => {
    expect(hexToLinearRgb('#000000')).toEqual([0, 0, 0])
    expect(hexToLinearRgb('FFFFFF')).toEqual([1, 1, 1])
    expect(() => hexToLinearRgb('#GGGGGG')).toThrow(/Invalid 6-digit hex color/)
    expect(() => hexToLinearRgb('#12345')).toThrow(/Invalid 6-digit hex color/)
  })

  const light = tokens.color.light
  const dark = tokens.color.dark

  describe('Light Mode Text Contrast', () => {
    const backgrounds = [
      { name: 'bgSurface (#FFFFFF)', hex: light.bgSurface },
      { name: 'bgApp (#FAFAF8)', hex: light.bgApp },
      { name: 'bgSubtle (#F6F6F3)', hex: light.bgSubtle },
    ]

    for (const bg of backgrounds) {
      it(`textPrimary meets WCAG AAA (>= 7:1) on ${bg.name}`, () => {
        const evalResult = evaluateWcagContrast(light.textPrimary, bg.hex)
        expect(evalResult.ratio).toBeGreaterThanOrEqual(15.0)
        expect(evalResult.passesAAA).toBe(true)
      })

      it(`textSecondary meets WCAG AA (>= 4.5:1) on ${bg.name}`, () => {
        const evalResult = evaluateWcagContrast(light.textSecondary, bg.hex)
        expect(evalResult.ratio).toBeGreaterThanOrEqual(5.5)
        expect(evalResult.passesAA).toBe(true)
      })

      it(`textTertiary meets WCAG AA Large / Graphical (>= 3:1) on ${bg.name}`, () => {
        const evalResult = evaluateWcagContrast(light.textTertiary, bg.hex)
        expect(evalResult.ratio).toBeGreaterThanOrEqual(3.0)
        expect(evalResult.passesAALarge).toBe(true)
      })

      it(`accentText meets WCAG AA (>= 4.5:1) on ${bg.name}`, () => {
        const evalResult = evaluateWcagContrast(light.accentText, bg.hex)
        expect(evalResult.ratio).toBeGreaterThanOrEqual(6.0)
        expect(evalResult.passesAA).toBe(true)
      })
    }

    it('accentText on accentSoft meets WCAG AA (>= 4.5:1)', () => {
      const evalResult = evaluateWcagContrast(light.accentText, light.accentSoft)
      expect(evalResult.ratio).toBeGreaterThanOrEqual(6.0)
      expect(evalResult.passesAA).toBe(true)
    })

    it('status colors on neutral surface meet WCAG AA or AA Large', () => {
      // success, danger, info meet 4.5:1 AA
      expect(calculateContrastRatio(light.success, light.bgSurface)).toBeGreaterThanOrEqual(4.5)
      expect(calculateContrastRatio(light.danger, light.bgSurface)).toBeGreaterThanOrEqual(4.5)
      expect(calculateContrastRatio(light.info, light.bgSurface)).toBeGreaterThanOrEqual(4.5)

      // warning meets 3:1 AA large/component threshold
      expect(calculateContrastRatio(light.warning, light.bgSurface)).toBeGreaterThanOrEqual(3.0)
    })
  })

  describe('Dark Mode Text Contrast', () => {
    const darkBackgrounds = [
      { name: 'bgApp (#111210)', hex: dark.bgApp },
      { name: 'bgSurface (#171816)', hex: dark.bgSurface },
      { name: 'bgSubtle (#1D1F1C)', hex: dark.bgSubtle },
    ]

    for (const bg of darkBackgrounds) {
      it(`textPrimary meets WCAG AAA (>= 7:1) on ${bg.name}`, () => {
        const evalResult = evaluateWcagContrast(dark.textPrimary, bg.hex)
        expect(evalResult.ratio).toBeGreaterThanOrEqual(14.0)
        expect(evalResult.passesAAA).toBe(true)
      })

      it(`textSecondary meets WCAG AAA (>= 7:1) on ${bg.name}`, () => {
        const evalResult = evaluateWcagContrast(dark.textSecondary, bg.hex)
        expect(evalResult.ratio).toBeGreaterThanOrEqual(7.0)
        expect(evalResult.passesAAA).toBe(true)
      })

      it(`textTertiary meets WCAG AA Large / Graphical (>= 3:1) on ${bg.name}`, () => {
        const evalResult = evaluateWcagContrast(dark.textTertiary, bg.hex)
        expect(evalResult.ratio).toBeGreaterThanOrEqual(4.0)
        expect(evalResult.passesAALarge).toBe(true)
      })
    }
  })
})
