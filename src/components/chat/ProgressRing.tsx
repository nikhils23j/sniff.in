import Svg, { Circle } from 'react-native-svg';
import { View } from 'react-native';

import { Text } from '@/components/ui';

/** Circular upload progress shown over a dimmed media preview. `value` is 0..1. */
export function ProgressRing({ value, size = 52 }: { value: number; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0.04, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Uploading ${Math.round(value * 100)} percent`}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.35)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r} stroke="#fff" strokeWidth={stroke} fill="none"
          strokeDasharray={`${c * v} ${c}`} strokeLinecap="round"
        />
      </Svg>
      <Text variant="micro" style={{ color: '#fff' }}>
        {Math.round(value * 100)}%
      </Text>
    </View>
  );
}
