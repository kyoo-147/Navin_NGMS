export class TokenValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenValidationError'
  }
}

export interface NavinLightColorTokens {
  bgApp: string
  bgSurface: string
  bgSubtle: string
  bgHover: string
  bgActive: string
  textPrimary: string
  textSecondary: string
  textTertiary: string
  borderDefault: string
  borderStrong: string
  divider: string
  accent: string
  accentHover: string
  accentActive: string
  accentSoft: string
  accentText: string
  accentVivid: string
  success: string
  warning: string
  danger: string
  info: string
}

export interface NavinDarkColorTokens {
  bgApp: string
  bgSurface: string
  bgSubtle: string
  bgHover: string
  bgActive: string
  textPrimary: string
  textSecondary: string
  textTertiary: string
  borderDefault: string
  borderStrong: string
  accent: string
  accentSoft: string
}

export interface NavinSpacingTokens {
  '1': number
  '2': number
  '3': number
  '4': number
  '5': number
  '6': number
  '8': number
  '10': number
  '12': number
  '16': number
  [key: string]: number
}

export interface NavinRadiusTokens {
  xs: number
  sm: number
  md: number
  lg: number
  xl: number
  [key: string]: number
}

export interface NavinLayoutTokens {
  sidebarWidth: number
  sidebarCollapsed: number
  headerHeight: number
  contentMax: number
  pagePadding: number
  mailSidebar: number
  mailRow: number
  mailToolbar: number
  mailAiDrawer: number
  controlSidebar: number
  controlHeader: number
  controlContentMax: number
  [key: string]: number
}

export interface NavinMotionTokens {
  fast: number
  default: number
  slow: number
  easing: string
}

export interface NavinTokens {
  color: {
    light: NavinLightColorTokens
    dark: NavinDarkColorTokens
  }
  spacing: NavinSpacingTokens
  radius: NavinRadiusTokens
  layout: NavinLayoutTokens
  motion: NavinMotionTokens
}

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

const REQUIRED_LIGHT_COLORS: (keyof NavinLightColorTokens)[] = [
  'bgApp',
  'bgSurface',
  'bgSubtle',
  'bgHover',
  'bgActive',
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'borderDefault',
  'borderStrong',
  'divider',
  'accent',
  'accentHover',
  'accentActive',
  'accentSoft',
  'accentText',
  'accentVivid',
  'success',
  'warning',
  'danger',
  'info',
]

const REQUIRED_DARK_COLORS: (keyof NavinDarkColorTokens)[] = [
  'bgApp',
  'bgSurface',
  'bgSubtle',
  'bgHover',
  'bgActive',
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'borderDefault',
  'borderStrong',
  'accent',
  'accentSoft',
]

const REQUIRED_SPACING_KEYS = ['1', '2', '3', '4', '5', '6', '8', '10', '12', '16']
const REQUIRED_RADIUS_KEYS = ['xs', 'sm', 'md', 'lg', 'xl']
const REQUIRED_LAYOUT_KEYS = [
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

function validateHexColor(value: unknown, path: string): string {
  if (typeof value !== 'string' || !HEX_COLOR_REGEX.test(value)) {
    throw new TokenValidationError(
      `Invalid hex color format for ${path}: expected 6-digit hex (e.g. #FFFFFF), got ${JSON.stringify(value)}`,
    )
  }
  return value
}

function validatePositiveNumber(value: unknown, path: string, allowZero = false): number {
  if (typeof value !== 'number' || isNaN(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new TokenValidationError(
      `Invalid spacing value for ${path}: expected number ${allowZero ? '>= 0' : '> 0'}, got ${JSON.stringify(value)}`,
    )
  }
  return value
}

export function validateTokensSchema(raw: unknown): NavinTokens {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TokenValidationError('Tokens source must be a valid JSON object')
  }

  const obj = raw as Record<string, unknown>

  if (!obj.color || typeof obj.color !== 'object') {
    throw new TokenValidationError('Missing required token: color')
  }
  const color = obj.color as Record<string, unknown>
  if (!color.light || typeof color.light !== 'object') {
    throw new TokenValidationError('Missing required token: color.light')
  }
  if (!color.dark || typeof color.dark !== 'object') {
    throw new TokenValidationError('Missing required token: color.dark')
  }

  const light = color.light as Record<string, unknown>
  for (const key of REQUIRED_LIGHT_COLORS) {
    if (light[key] === undefined) {
      throw new TokenValidationError(`Missing required token: color.light.${key}`)
    }
    validateHexColor(light[key], `color.light.${key}`)
  }

  const dark = color.dark as Record<string, unknown>
  for (const key of REQUIRED_DARK_COLORS) {
    if (dark[key] === undefined) {
      throw new TokenValidationError(`Missing required token: color.dark.${key}`)
    }
    validateHexColor(dark[key], `color.dark.${key}`)
  }

  if (!obj.spacing || typeof obj.spacing !== 'object') {
    throw new TokenValidationError('Missing required token: spacing')
  }
  const spacing = obj.spacing as Record<string, unknown>
  for (const key of REQUIRED_SPACING_KEYS) {
    if (spacing[key] === undefined) {
      throw new TokenValidationError(`Missing required token: spacing.${key}`)
    }
    validatePositiveNumber(spacing[key], `spacing.${key}`)
  }

  if (!obj.radius || typeof obj.radius !== 'object') {
    throw new TokenValidationError('Missing required token: radius')
  }
  const radius = obj.radius as Record<string, unknown>
  for (const key of REQUIRED_RADIUS_KEYS) {
    if (radius[key] === undefined) {
      throw new TokenValidationError(`Missing required token: radius.${key}`)
    }
    validatePositiveNumber(radius[key], `radius.${key}`, true)
  }

  if (!obj.layout || typeof obj.layout !== 'object') {
    throw new TokenValidationError('Missing required token: layout')
  }
  const layout = obj.layout as Record<string, unknown>
  for (const key of REQUIRED_LAYOUT_KEYS) {
    if (layout[key] === undefined) {
      throw new TokenValidationError(`Missing required token: layout.${key}`)
    }
    validatePositiveNumber(layout[key], `layout.${key}`)
  }

  if (!obj.motion || typeof obj.motion !== 'object') {
    throw new TokenValidationError('Missing required token: motion')
  }
  const motion = obj.motion as Record<string, unknown>
  for (const key of ['fast', 'default', 'slow']) {
    if (motion[key] === undefined) {
      throw new TokenValidationError(`Missing required token: motion.${key}`)
    }
    validatePositiveNumber(motion[key], `motion.${key}`)
  }
  if (!motion.easing || typeof motion.easing !== 'string') {
    throw new TokenValidationError('Missing required token: motion.easing')
  }

  return raw as NavinTokens
}
