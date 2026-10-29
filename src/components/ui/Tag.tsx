import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

type Tone = 'neutral' | 'brand' | 'accent' | 'warning';

export function Tag({
  label, selected, onPress, tone = 'neutral', icon, onRemove, small,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
  onRemove?: () => void;
  small?: boolean;
}) {
  const { colors, radius } = useTheme();
  const toneBg: Record<Tone, string> = {
    neutral: colors.surfaceMuted, brand: colors.primarySoft, accent: colors.accentSoft, warning: colors.warningSoft,
  };
  const toneFg: Record<Tone, string> = {
    neutral: colors.textSecondary, brand: colors.primary, accent: colors.accentStrong, warning: colors.warning,
  };
  const bg = selected ? colors.primary : toneBg[tone];
  const fg = selected ? colors.onPrimary : toneFg[tone];
  const content = (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: bg, borderRadius: radius.pill,
        paddingHorizontal: small ? 9 : 12, paddingVertical: small ? 4 : 7,
      }}>
      {icon ? <Ionicons name={icon} size={small ? 12 : 14} color={fg} /> : null}
      {selected && !icon ? <Ionicons name="checkmark" size={14} color={fg} /> : null}
      <Text variant={small ? 'micro' : 'caption'} style={{ color: fg, letterSpacing: small ? 0.2 : 0 }} numberOfLines={1}>
        {label}
      </Text>
      {onRemove ? (
        <Pressable accessibilityLabel={`Remove ${label}`} hitSlop={10} onPress={onRemove}>
          <Ionicons name="close" size={14} color={fg} />
        </Pressable>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      {content}
    </Pressable>
  );
}

export function TagList({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}
