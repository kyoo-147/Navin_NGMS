import { describe, it, expect } from 'vitest'
import { validateTokensSchema, TokenValidationError } from '../src/generator/schema.js'

describe('Token Schema & Shape Validation', () => {
  const validTokens = {
    color: {
      light: {
        bgApp: '#FAFAF8',
        bgSurface: '#FFFFFF',
        bgSubtle: '#F6F6F3',
        bgHover: '#F2F2EE',
        bgActive: '#ECEDE8',
        textPrimary: '#171816',
        textSecondary: '#60635D',
        textTertiary: '#8A8D86',
        borderDefault: '#E4E5E0',
        borderStrong: '#D3D5CF',
        divider: '#ECEDE9',
        accent: '#7BCB45',
        accentHover: '#6DBC39',
        accentActive: '#5EA92F',
        accentSoft: '#EEF8E8',
        accentText: '#32691A',
        accentVivid: '#9CEC25',
        success: '#2F7D32',
        warning: '#A66A00',
        danger: '#C83E3A',
        info: '#456B8C',
      },
      dark: {
        bgApp: '#111210',
        bgSurface: '#171816',
        bgSubtle: '#1D1F1C',
        bgHover: '#252723',
        bgActive: '#2D302A',
        textPrimary: '#F2F3EF',
        textSecondary: '#AEB2A8',
        textTertiary: '#80847C',
        borderDefault: '#2B2E29',
        borderStrong: '#3A3D36',
        accent: '#8ED95A',
        accentSoft: '#20331A',
      },
    },
    spacing: {
      '1': 4,
      '2': 8,
      '3': 12,
      '4': 16,
      '5': 20,
      '6': 24,
      '8': 32,
      '10': 40,
      '12': 48,
      '16': 64,
    },
    radius: {
      xs: 4,
      sm: 6,
      md: 8,
      lg: 10,
      xl: 12,
    },
    layout: {
      sidebarWidth: 224,
      sidebarCollapsed: 56,
      headerHeight: 52,
      contentMax: 1440,
      pagePadding: 24,
      mailSidebar: 224,
      mailRow: 40,
      mailToolbar: 48,
      mailAiDrawer: 320,
      controlSidebar: 216,
      controlHeader: 52,
      controlContentMax: 1120,
    },
    motion: {
      fast: 120,
      default: 180,
      slow: 240,
      easing: 'cubic-bezier(.2,.8,.2,1)',
    },
  }

  it('validates a correct tokens structure successfully', () => {
    const validated = validateTokensSchema(validTokens)
    expect(validated).toEqual(validTokens)
  })

  it('fails clearly when canonical source is missing a required light color', () => {
    const invalid = JSON.parse(JSON.stringify(validTokens))
    delete invalid.color.light.accent

    expect(() => validateTokensSchema(invalid)).toThrow(TokenValidationError)
    expect(() => validateTokensSchema(invalid)).toThrow(
      /Missing required token: color\.light\.accent/,
    )
  })

  it('fails clearly when canonical source is missing a required dark color', () => {
    const invalid = JSON.parse(JSON.stringify(validTokens))
    delete invalid.color.dark.bgSurface

    expect(() => validateTokensSchema(invalid)).toThrow(TokenValidationError)
    expect(() => validateTokensSchema(invalid)).toThrow(
      /Missing required token: color\.dark\.bgSurface/,
    )
  })

  it('fails clearly when a color value is not a valid hex code', () => {
    const invalid = JSON.parse(JSON.stringify(validTokens))
    invalid.color.light.textPrimary = 'rgb(0,0,0)'

    expect(() => validateTokensSchema(invalid)).toThrow(TokenValidationError)
    expect(() => validateTokensSchema(invalid)).toThrow(
      /Invalid hex color format for color\.light\.textPrimary/,
    )
  })

  it('fails clearly when spacing is missing a scale entry or is negative', () => {
    const invalid = JSON.parse(JSON.stringify(validTokens))
    delete invalid.spacing['4']

    expect(() => validateTokensSchema(invalid)).toThrow(TokenValidationError)
    expect(() => validateTokensSchema(invalid)).toThrow(/Missing required token: spacing\.4/)

    const invalidValue = JSON.parse(JSON.stringify(validTokens))
    invalidValue.spacing['1'] = -2
    expect(() => validateTokensSchema(invalidValue)).toThrow(TokenValidationError)
    expect(() => validateTokensSchema(invalidValue)).toThrow(/Invalid spacing value for spacing\.1/)
  })

  it('fails clearly when radius is missing a size', () => {
    const invalid = JSON.parse(JSON.stringify(validTokens))
    delete invalid.radius.md

    expect(() => validateTokensSchema(invalid)).toThrow(TokenValidationError)
    expect(() => validateTokensSchema(invalid)).toThrow(/Missing required token: radius\.md/)
  })

  it('fails clearly when layout token is missing', () => {
    const invalid = JSON.parse(JSON.stringify(validTokens))
    delete invalid.layout.sidebarWidth

    expect(() => validateTokensSchema(invalid)).toThrow(TokenValidationError)
    expect(() => validateTokensSchema(invalid)).toThrow(
      /Missing required token: layout\.sidebarWidth/,
    )
  })

  it('fails clearly when motion timing or easing is missing or invalid', () => {
    const invalid = JSON.parse(JSON.stringify(validTokens))
    delete invalid.motion.easing

    expect(() => validateTokensSchema(invalid)).toThrow(TokenValidationError)
    expect(() => validateTokensSchema(invalid)).toThrow(/Missing required token: motion\.easing/)
  })

  it('validates the canonical docs/design/navin-tokens.json without error', async () => {
    const fs = await import('fs')
    const { fileURLToPath } = await import('node:url')
    const tokensPath = fileURLToPath(
      new URL('../../../docs/design/navin-tokens.json', import.meta.url),
    )
    const raw = JSON.parse(fs.readFileSync(tokensPath, 'utf8'))
    const validated = validateTokensSchema(raw)
    expect(validated.color.light.accent).toBe('#7BCB45')
    expect(validated.color.dark.accent).toBe('#8ED95A')
  })
})
