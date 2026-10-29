import { Pressable, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

type CardProps = ViewProps & {
  onPress?: () => void;
  padded?: boolean;
  tone?: 'default' | 'brand' | 'muted';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Card({ onPress, padded = true, tone = 'default', style, children, accessibilityLabel, ...rest }: CardProps) {
  const t = useTheme();
  const bg = tone === 'brand' ? t.colors.surfaceBrand : tone === 'muted' ? t.colors.surfaceMuted : t.colors.surface;
  const base: ViewStyle = {
    backgroundColor: bg,
    borderRadius: t.radius.xl,
    borderWidth: 1,
    borderColor: tone === 'default' ? t.colors.border : 'transparent',
    padding: padded ? t.spacing.lg : 0,
    shadowColor: t.colors.shadow,
    ...(tone === 'default' && t.scheme === 'light' ? t.shadows.card : {}),
  };
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [base, { opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] }, style]}
        {...rest}>
        {children}
      </Pressable>
    );
  }
  return (
    <View style={[base, style]} {...rest}>
      {children}
    </View>
  );
}
