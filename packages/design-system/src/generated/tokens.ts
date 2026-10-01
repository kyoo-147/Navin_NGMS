/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY.
 * Generated from docs/design/navin-tokens.json
 */

export const tokens = {
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
} as const

export const cssVariables = {
  color: {
    bgApp: 'var(--bg-app)',
    bgSurface: 'var(--bg-surface)',
    bgSubtle: 'var(--bg-subtle)',
    bgHover: 'var(--bg-hover)',
    bgActive: 'var(--bg-active)',
    textPrimary: 'var(--text-primary)',
    textSecondary: 'var(--text-secondary)',
    textTertiary: 'var(--text-tertiary)',
    borderDefault: 'var(--border-default)',
    borderStrong: 'var(--border-strong)',
    divider: 'var(--divider)',
    accent: 'var(--accent)',
    accentHover: 'var(--accent-hover)',
    accentActive: 'var(--accent-active)',
    accentSoft: 'var(--accent-soft)',
    accentText: 'var(--accent-text)',
    accentVivid: 'var(--accent-vivid)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
    info: 'var(--info)',
  },
  spacing: {
    '1': 'var(--space-1)',
    '2': 'var(--space-2)',
    '3': 'var(--space-3)',
    '4': 'var(--space-4)',
    '5': 'var(--space-5)',
    '6': 'var(--space-6)',
    '8': 'var(--space-8)',
    '10': 'var(--space-10)',
    '12': 'var(--space-12)',
    '16': 'var(--space-16)',
  },
  radius: {
    xs: 'var(--radius-xs)',
    sm: 'var(--radius-sm)',
    md: 'var(--radius-md)',
    lg: 'var(--radius-lg)',
    xl: 'var(--radius-xl)',
  },
  layout: {
    sidebarWidth: 'var(--sidebar-width)',
    sidebarCollapsed: 'var(--sidebar-collapsed)',
    headerHeight: 'var(--header-height)',
    contentMax: 'var(--content-max)',
    pagePadding: 'var(--page-padding)',
    mailSidebar: 'var(--mail-sidebar)',
    mailRow: 'var(--mail-row)',
    mailToolbar: 'var(--mail-toolbar)',
    mailAiDrawer: 'var(--mail-ai-drawer)',
    controlSidebar: 'var(--control-sidebar)',
    controlHeader: 'var(--control-header)',
    controlContentMax: 'var(--control-content-max)',
  },
  motion: {
    fast: 'var(--motion-fast)',
    default: 'var(--motion-default)',
    slow: 'var(--motion-slow)',
    ease: 'var(--motion-ease)',
    easing: 'var(--motion-easing)',
  },
} as const

export type Tokens = typeof tokens
export type LightColorToken = keyof typeof tokens.color.light
export type DarkColorToken = keyof typeof tokens.color.dark
export type SpacingToken = keyof typeof tokens.spacing
export type RadiusToken = keyof typeof tokens.radius
export type LayoutToken = keyof typeof tokens.layout
export type MotionToken = keyof typeof tokens.motion

export default tokens
