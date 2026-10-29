import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

export function ChoiceGrid({
  options, value, onChange, multi = false,
}: {
  options: { value: string; label: string; emoji?: string }[];
  value: string | string[] | null;
  onChange: (value: string | string[]) => void;
  multi?: boolean;
}) {
  const t = useTheme();
  const selected = (key: string) => Array.isArray(value) ? value.includes(key) : value === key;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {options.map((option) => {
        const active = selected(option.value);
        return (
          <Pressable
            key={option.value}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: active }}
            onPress={() => {
              if (!multi) return onChange(option.value);
              const current = Array.isArray(value) ? value : [];
              onChange(active ? current.filter((v) => v !== option.value) : [...current, option.value]);
            }}
            style={({ pressed }) => ({
              minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: t.radius.pill,
              borderWidth: active ? 2 : 1, borderColor: active ? t.colors.primary : t.colors.border,
              backgroundColor: active ? t.colors.primarySoft : pressed ? t.colors.surfaceMuted : t.colors.surface,
              flexDirection: 'row', alignItems: 'center', gap: 7,
            })}>
            {option.emoji ? <Text variant="body">{option.emoji}</Text> : null}
            <Text variant="callout" style={{ color: active ? t.colors.primary : t.colors.text, fontWeight: active ? '700' : '500' }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function VisibilityChoice({ value, onChange }: { value: string; onChange: (value: 'members' | 'connections' | 'only_me') => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text variant="caption" color="textSecondary">Visible on profile</Text>
      <ChoiceGrid
        options={[{ value: 'members', label: 'Server members' }, { value: 'connections', label: 'Connections' }, { value: 'only_me', label: 'Only me' }]}
        value={value}
        onChange={(v) => onChange(v as 'members' | 'connections' | 'only_me')}
      />
    </View>
  );
}
