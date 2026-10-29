import { View } from 'react-native';

import { useMediaQuality, QUALITY_PRESETS } from '@/features/media/quality';

import { SegmentedControl, Text } from './ui';

/** A device preference shared by all new photo uploads, so users choose once. */
export function MediaQualityControl() {
  const mode = useMediaQuality((s) => s.mode);
  const setMode = useMediaQuality((s) => s.setMode);
  return <View style={{ gap: 5 }}>
    <Text variant="caption" color="textSecondary">Photo upload quality</Text>
    <SegmentedControl value={mode} onChange={setMode} options={[
      { value: 'small', label: 'Small' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'best', label: 'Best' },
    ]} />
    <Text variant="micro" color="textTertiary">{QUALITY_PRESETS[mode].description}. Applies to new photos throughout the app.</Text>
  </View>;
}
