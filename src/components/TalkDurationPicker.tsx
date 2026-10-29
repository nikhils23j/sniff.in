import { View } from 'react-native';

import { SegmentedControl, Tag, TagList, Text, TextField } from '@/components/ui';
import {
  TALK_PRESETS, formatClock, minutesUntil, resolveTalkMinutes, type TalkDuration, type TalkUnit,
} from '@/features/servers/presets';
import { useNow } from '@/hooks/use-now';

/**
 * Open to Talk duration: 30 min / 2 h / 4 h / Custom (minutes or hours, 1 min – 12 h).
 * `endsAt` (a temporary Server's end) caps the duration; the backend applies the same cap.
 */
export function TalkDurationPicker({
  value, onChange, endsAt, label = 'For how long?', tone = 'default',
}: {
  value: TalkDuration;
  onChange: (v: TalkDuration) => void;
  endsAt?: string | null;
  label?: string;
  tone?: 'default' | 'onBrand';
}) {
  const now = useNow(30_000);
  const cap = minutesUntil(endsAt, now);
  const resolved = resolveTalkMinutes(value, cap);
  const onBrand = tone === 'onBrand';
  const summary = 'error' in resolved
    ? resolved.error
    : `Until ${formatClock(now + resolved.minutes * 60_000)}${resolved.capped ? ' (when this Server ends)' : ''}`;

  return (
    <View style={{ gap: 10 }}>
      <Text variant="subheading" style={onBrand ? { color: '#fff' } : undefined}>
        {label}
      </Text>
      <TagList>
        {TALK_PRESETS.map((p) => (
          <Tag
            key={p.key}
            label={p.label}
            selected={value.preset === p.key}
            onPress={() => onChange({ ...value, preset: p.key })}
          />
        ))}
        <Tag
          label="Custom"
          icon="time-outline"
          selected={value.preset === 'custom'}
          onPress={() => onChange({ ...value, preset: 'custom' })}
        />
      </TagList>
      {value.preset === 'custom' ? (
        <View style={{ gap: 8 }}>
          <SegmentedControl<TalkUnit>
            options={[{ value: 'min', label: 'Minutes' }, { value: 'h', label: 'Hours' }]}
            value={value.unit}
            onChange={(unit) => onChange({ ...value, unit })}
          />
          <TextField
            label={value.unit === 'h' ? 'Hours (up to 12)' : 'Minutes (1–720)'}
            value={value.custom}
            onChangeText={(custom) => onChange({ ...value, custom: custom.replace(/[^0-9.,]/g, '') })}
            keyboardType="decimal-pad"
            maxLength={5}
            accessibilityLabel={value.unit === 'h' ? 'Custom duration in hours' : 'Custom duration in minutes'}
          />
        </View>
      ) : null}
      <Text
        variant="caption"
        color={'error' in resolved ? 'danger' : 'textSecondary'}
        style={onBrand ? { color: 'rgba(255,255,255,0.9)' } : undefined}
        accessibilityLiveRegion="polite">
        {summary}
      </Text>
    </View>
  );
}
