import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Switch, View } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export function SegmentedControl<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string; badge?: number }[]; value: T; onChange: (v: T) => void }) {
  const { colors, radius } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 3 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1, paddingVertical: 8, borderRadius: radius.sm + 2, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
              backgroundColor: active ? colors.surface : 'transparent',
              shadowColor: '#000', shadowOpacity: active ? 0.06 : 0, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: active ? 1 : 0,
            }}>
            <Text variant="caption" style={{ color: active ? colors.text : colors.textSecondary }}>
              {o.label}
            </Text>
            {o.badge ? (
              <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="micro" style={{ color: colors.onPrimary }}>
                  {o.badge > 99 ? '99+' : o.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ListRow({
  icon, title, subtitle, right, onPress, chevron = !!onPress, tone = 'default', disabled,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const fg = tone === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      disabled={!onPress || disabled}
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16,
        backgroundColor: pressed ? colors.surfaceMuted : 'transparent', opacity: disabled ? 0.5 : 1,
      })}>
      {icon ? (
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: tone === 'danger' ? colors.dangerSoft : colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={18} color={tone === 'danger' ? colors.danger : colors.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="callout" style={{ color: fg }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

export function SwitchRow({
  title, subtitle, value, onValueChange, disabled, icon,
}: { title: string; subtitle?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap }) {
  const { colors } = useTheme();
  return (
    <ListRow
      icon={icon}
      title={title}
      subtitle={subtitle}
      chevron={false}
      right={
        <Switch
          accessibilityLabel={title}
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ true: colors.primary, false: colors.borderStrong }}
          thumbColor="#fff"
        />
      }
    />
  );
}

/** Grouped settings list surface. */
export function ListGroup({ children }: { children: React.ReactNode }) {
  const { colors, radius } = useTheme();
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 16 }} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/** Choice list with radio semantics (used for visibility levels, durations, reasons…). */
export function RadioGroup<T extends string | number>({
  options, value, onChange,
}: { options: { value: T; label: string; description?: string }[]; value: T; onChange: (v: T) => void }) {
  const { colors } = useTheme();
  return (
    <ListGroup>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: pressed ? colors.surfaceMuted : 'transparent' })}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="callout">{o.label}</Text>
              {o.description ? (
                <Text variant="caption" color="textSecondary">
                  {o.description}
                </Text>
              ) : null}
            </View>
            <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.textTertiary} />
          </Pressable>
        );
      })}
    </ListGroup>
  );
}
