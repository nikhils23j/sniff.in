import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme, type ThemeColors, type TypographyVariant } from '@/theme';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: keyof ThemeColors;
  align?: 'left' | 'center' | 'right';
};

export function Text({ variant = 'body', color = 'text', align, style, ...rest }: TextProps) {
  const t = useTheme();
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={1.6}
      style={[t.typography[variant], { color: t.colors[color], textAlign: align }, style]}
    />
  );
}
