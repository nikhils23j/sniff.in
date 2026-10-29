import { useColorScheme } from 'react-native';

import { colors, radius, shadows, spacing, typography, type ThemeColors } from './tokens';

export * from './tokens';

export type Theme = {
  scheme: 'light' | 'dark';
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadows: typeof shadows;
};

export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: colors[scheme], spacing, radius, typography, shadows };
}
