import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

/** Onboarding header: optional back button, segmented progress bar and "Step n of N". */
export function StepProgress({ step, total = 5, back = true }: { step: number; total?: number; back?: boolean }) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: step }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: back ? 8 : t.spacing.xl, paddingTop: 8, paddingBottom: 4, minHeight: 52 }}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          onPress={() => (router.canGoBack() ? router.back() : undefined)}
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.colors.surfaceMuted : 'transparent' })}>
          <Ionicons name="chevron-back" size={24} color={t.colors.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i < step ? t.colors.primary : t.colors.borderStrong }}
          />
        ))}
      </View>
      <Text variant="caption" color="textSecondary" style={{ marginRight: back ? 8 : 0 }}>
        {step}/{total}
      </Text>
    </View>
  );
}
