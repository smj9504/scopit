/**
 * Scopit Design Theme
 * Clean, confident design system for restoration professionals
 */

export const colors = {
  // Primary
  primary: '#111827',
  primaryHover: '#1f2937',
  primarySubtle: '#f8fafc',

  // Background
  bgWhite: '#ffffff',
  bgLight: '#f9fafb',
  bgDark: '#111827',
  bgElevated: '#ffffff',
  bgSunken: '#f3f4f6',

  // Border
  border: '#e5e7eb',
  borderDark: '#d1d5db',
  borderDarkMode: '#1f2937',
  borderLight: '#f3f4f6',

  // Text
  textPrimary: '#111827',
  textSecondary: '#4b5563',
  textMuted: '#9ca3af',
  textWhite: '#ffffff',

  // Status
  success: '#059669',
  successBg: '#ecfdf5',
  warning: '#d97706',
  warningBg: '#fffbeb',
  error: '#dc2626',
  errorBg: '#fef2f2',
  info: '#2563eb',
  infoBg: '#eff6ff',

  // Accent — used for interactive highlights and numeric emphasis
  accent: '#2563eb',
  accentSubtle: '#eff6ff',
} as const;

export const fonts = {
  heading: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  body: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
} as const;

export const fontSizes = {
  xs: '12px',
  sm: '13px',
  base: '14px',
  md: '15px',
  lg: '16px',
  xl: '18px',
  '2xl': '22px',
  '3xl': '26px',
  '4xl': '32px',
  '5xl': '48px',
} as const;

export const fontWeights = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

export const lineHeights = {
  tight: 1.2,
  snug: 1.3,
  normal: 1.5,
  relaxed: 1.6,
} as const;

export const borderRadius = {
  sm: '4px',
  base: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

export const spacing = {
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const;

export const shadows = {
  none: 'none',
  xs: '0 1px 2px rgba(0, 0, 0, 0.04)',
  sm: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
  base: '0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
  md: '0 4px 12px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.04)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.08), 0 4px 8px rgba(0, 0, 0, 0.04)',
  xl: '0 16px 40px rgba(0, 0, 0, 0.1), 0 8px 16px rgba(0, 0, 0, 0.05)',
  // Cards at rest — visible but quiet
  card: '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
  // Cards on hover — lifted
  cardHover: '0 4px 12px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.03)',
  // Sticky headers and floating elements
  sticky: '0 2px 8px rgba(0, 0, 0, 0.06)',
} as const;

export const transitions = {
  fast: '0.15s ease',
  base: '0.2s ease',
  slow: '0.3s ease',
} as const;

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;

// Ant Design theme config
export const antdTheme = {
  token: {
    colorPrimary: colors.primary,
    colorBgContainer: colors.bgWhite,
    colorBorder: colors.border,
    colorText: colors.textPrimary,
    colorTextSecondary: colors.textSecondary,
    fontFamily: fonts.body,
    borderRadius: 8,
    wireframe: false,
    colorSuccess: colors.success,
    colorWarning: colors.warning,
    colorError: colors.error,
    colorInfo: colors.info,
    boxShadow: shadows.base,
    boxShadowSecondary: shadows.md,
  },
  components: {
    Button: {
      borderRadius: 8,
      controlHeight: 36,
      fontWeight: 600,
      fontSize: 14,
    },
    Input: {
      borderRadius: 8,
      controlHeight: 36,
      fontSize: 14,
      activeShadow: `0 0 0 2px ${colors.accentSubtle}`,
    },
    InputNumber: {
      borderRadius: 8,
      controlHeight: 36,
      fontSize: 14,
    },
    Select: {
      borderRadius: 8,
      controlHeight: 36,
      fontSize: 14,
    },
    DatePicker: {
      borderRadius: 8,
      controlHeight: 36,
      fontSize: 14,
    },
    Form: {
      labelFontSize: 13,
      fontSize: 14,
      labelColor: colors.textSecondary,
    },
    Table: {
      borderRadius: 12,
      headerBg: colors.bgLight,
      headerColor: colors.textSecondary,
      fontSize: 14,
      rowHoverBg: colors.primarySubtle,
    },
    Card: {
      borderRadiusLG: 12,
    },
    Modal: {
      borderRadiusLG: 14,
    },
    Menu: {
      itemSelectedBg: colors.primary,
      itemSelectedColor: colors.textWhite,
      itemHoverBg: colors.bgSunken,
      itemBorderRadius: 8,
      iconSize: 18,
      itemMarginInline: 0,
      itemPaddingInline: 16,
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Dropdown: {
      borderRadiusLG: 10,
    },
  },
};

export const theme = {
  colors,
  fonts,
  fontSizes,
  fontWeights,
  lineHeights,
  borderRadius,
  spacing,
  shadows,
  transitions,
  breakpoints,
};

export type Theme = typeof theme;
export default theme;
