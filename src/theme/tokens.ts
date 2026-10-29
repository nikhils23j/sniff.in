/**
 * Sniff.in design tokens (v2, festive). Warm cream surfaces, a bright violet brand colour (from the logo's
 * indigo, lifted), and celebratory accents inspired by Holi, Diwali and rangoli. Colourful, never muddy.
 */
export const palette = {
  // brand
  violet900: '#2A1A6E',
  violet700: '#4B2BC9',
  violet600: '#6C3CE9', // primary
  violet500: '#8A63F2',
  violet300: '#C4B2FA',
  violet100: '#EFE9FF',
  violet50: '#F7F3FF',
  indigo700: '#3A2E80', // logo ink
  // festive accents
  saffron600: '#F07A00',
  saffron500: '#FF8A00',
  saffron100: '#FFEBD3',
  marigold500: '#FFB800',
  marigold100: '#FFF3CC',
  rani600: '#D81B60',
  rani500: '#E91E63',
  rani100: '#FDE2EC',
  teal600: '#0EA59B',
  teal500: '#13C4B8',
  teal300: '#7FE6DE',
  teal100: '#D8F7F4',
  peacock500: '#0E7CC9',
  peacock100: '#DCEEFB',
  leaf500: '#2BAE66',
  leaf100: '#DDF5E7',
  // neutrals (warm)
  ink: '#22202B',
  slate600: '#615C6E',
  slate400: '#948EA3',
  sand200: '#EDE3D7',
  sand100: '#F6EEE4',
  sand50: '#FFF6EC',
  cream: '#FFFBF5',
  white: '#FFFFFF',
  red600: '#D93A3A',
  red100: '#FCE4E4',
  amber600: '#C27A12',
  amber100: '#FCF0DC',
  green600: '#1E9E5E',
  green100: '#DDF4EA',
  // dark
  night: '#15121F',
  night2: '#1E1A2B',
  night3: '#2A2439',
  night4: '#3A3350',
} as const;

/** Gradients for hero cards, CTAs and stickers. */
export const gradients = {
  sunrise: [palette.saffron500, palette.rani500] as const,
  holi: [palette.rani500, palette.violet600] as const,
  peacock: [palette.teal500, palette.peacock500] as const,
  diya: [palette.marigold500, palette.saffron500] as const,
  brand: [palette.violet600, palette.teal500] as const,
};

/** Rotating accent colours for categories, chips and avatars (Instagram-style variety). */
export const accents = [palette.rani500, palette.saffron500, palette.teal500, palette.violet600, palette.peacock500, palette.leaf500, palette.marigold500] as const;

export type ColorScheme = 'light' | 'dark';

const lightDef = {
  background: palette.cream,
  surface: palette.white,
  surfaceMuted: palette.sand50,
  surfaceBrand: palette.violet50,
  border: palette.sand100,
  borderStrong: palette.sand200,
  text: palette.ink,
  textSecondary: palette.slate600,
  textTertiary: palette.slate400,
  textInverse: palette.white,
  primary: palette.violet600,
  primaryPressed: palette.violet700,
  primarySoft: palette.violet100,
  onPrimary: palette.white,
  accent: palette.teal500,
  accentStrong: palette.teal600,
  accentSoft: palette.teal100,
  festive: palette.saffron500,
  festiveSoft: palette.saffron100,
  pink: palette.rani500,
  pinkSoft: palette.rani100,
  success: palette.green600,
  successSoft: palette.green100,
  warning: palette.amber600,
  warningSoft: palette.amber100,
  danger: palette.red600,
  dangerSoft: palette.red100,
  overlay: 'rgba(34, 20, 60, 0.45)',
  shadow: '#5B3A1E',
};

export type ThemeColors = { [K in keyof typeof lightDef]: string };
const light: ThemeColors = lightDef;

const dark: ThemeColors = {
  background: palette.night,
  surface: palette.night2,
  surfaceMuted: palette.night3,
  surfaceBrand: '#251C4A',
  border: palette.night3,
  borderStrong: palette.night4,
  text: '#F5F2FA',
  textSecondary: '#B5AEC6',
  textTertiary: '#827A96',
  textInverse: palette.ink,
  primary: palette.violet500,
  primaryPressed: palette.violet600,
  primarySoft: '#2E2460',
  onPrimary: palette.white,
  accent: '#2FD8CC',
  accentStrong: palette.teal300,
  accentSoft: '#11393A',
  festive: '#FF9F2E',
  festiveSoft: '#3A2611',
  pink: '#F0508A',
  pinkSoft: '#3D1627',
  success: '#3CC48D',
  successSoft: '#123326',
  warning: '#E8A23C',
  warningSoft: '#3A2A10',
  danger: '#F06A6A',
  dangerSoft: '#3D1818',
  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',
};

export const colors: Record<ColorScheme, ThemeColors> = { light, dark };

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

export const typography = {
  display: { fontFamily: fonts.extrabold, fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  title: { fontFamily: fonts.extrabold, fontSize: 25, lineHeight: 31, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  subheading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23 },
  callout: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.4 },
} as const;

export type TypographyVariant = keyof typeof typography;

export const shadows = {
  card: { shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  raised: { shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
} as const;
