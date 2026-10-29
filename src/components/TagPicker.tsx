import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Tag, TagList, Text, TextField } from '@/components/ui';
import { useTagSearch } from '@/features/profile/hooks';
import { tagNameSchema } from '@/lib/validation';
import { useTheme } from '@/theme';
import type { TagKind } from '@/types/domain';

type Props = {
  kind: TagKind;
  title: string;
  description?: string;
  value: string[];
  onChange: (next: string[]) => void;
  starters: readonly string[];
  max?: number;
  placeholder?: string;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Selected tags (removable), a field to add custom ones, and suggestions (popular tags + a starter list). */
export function TagPicker({ kind, title, description, value, onChange, starters, max = 15, placeholder }: Props) {
  const t = useTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  // Suggestion lookup is best-effort; failures just fall back to the starter list.
  const search = useTagSearch(kind, debounced);
  const full = value.length >= max;

  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    const pool: string[] = [];
    const push = (n: string) => {
      if (!pool.some((p) => same(p, n)) && !value.some((v) => same(v, n))) pool.push(n);
    };
    const fromServer = (search.data ?? []).map((r) => r.name);
    if (q) {
      fromServer.forEach(push);
      starters.filter((s) => s.toLowerCase().includes(q)).forEach(push);
    } else {
      starters.forEach(push);
      fromServer.forEach(push);
    }
    return pool.slice(0, 14);
  }, [search.data, starters, text, value]);

  const add = (raw: string) => {
    const parsed = tagNameSchema.safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a tag');
      return;
    }
    if (value.some((v) => same(v, parsed.data))) {
      setError('You already added that');
      return;
    }
    if (full) {
      setError(`You can add up to ${max}`);
      return;
    }
    onChange([...value, parsed.data]);
    setText('');
    setError(undefined);
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text variant="heading" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="caption" color="textTertiary">
            {value.length}/{max}
          </Text>
        </View>
        {description ? (
          <Text variant="caption" color="textSecondary">
            {description}
          </Text>
        ) : null}
      </View>

      {value.length > 0 ? (
        <TagList>
          {value.map((v) => (
            <Tag key={v} label={v} tone="brand" onRemove={() => onChange(value.filter((x) => x !== v))} />
          ))}
        </TagList>
      ) : null}

      <TextField
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (error) setError(undefined);
        }}
        placeholder={placeholder ?? `Add your own ${title.toLowerCase()}`}
        accessibilityLabel={`Add ${title.toLowerCase()}`}
        error={error}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        maxLength={40}
        editable={!full}
        onSubmitEditing={() => text.trim() && add(text)}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${text.trim() || 'tag'}`}
            accessibilityState={{ disabled: !text.trim() || full }}
            disabled={!text.trim() || full}
            hitSlop={8}
            onPress={() => add(text)}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || full ? 0.35 : 1, backgroundColor: t.colors.primarySoft }}>
            <Ionicons name="add" size={20} color={t.colors.primary} />
          </Pressable>
        }
      />

      {suggestions.length > 0 && !full ? (
        <TagList>
          {suggestions.map((s) => (
            <Tag key={s} label={s} icon="add" onPress={() => add(s)} />
          ))}
        </TagList>
      ) : null}
    </View>
  );
}
