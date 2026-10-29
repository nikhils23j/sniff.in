import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

type Side = 'left' | 'right';

export type DeckAction = { label: string; icon: keyof typeof Ionicons.glyphMap };

/**
 * A Hinge/Bumble-style card stack: drag the top card left to skip or right for its primary action; tap it for
 * details. Buttons under the deck do the same for people who prefer (or need) taps over gestures.
 */
export function SwipeDeck<T>({
  items, keyOf, renderCard, onSkip, onPrimary, onOpen, primaryFor, height, emptyState,
}: {
  items: T[];
  keyOf: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onSkip?: (item: T) => void;
  onPrimary: (item: T) => void;
  onOpen: (item: T) => void;
  primaryFor: (item: T) => DeckAction;
  height: number;
  emptyState: ReactNode;
}) {
  const { colors } = useTheme();
  const [skipped, setSkipped] = useState<string[]>([]);
  const visible = items.filter((item) => !skipped.includes(keyOf(item)));
  const top = visible[0];
  const next = visible[1];
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const [width, setWidth] = useState(360);

  const topKey = top ? keyOf(top) : null;
  useEffect(() => { x.set(0); y.set(0); }, [topKey, x, y]);

  const finish = (side: Side) => {
    if (!top) return;
    void Haptics.selectionAsync().catch(() => {});
    setSkipped((s) => [...s, keyOf(top)]);
    if (side === 'left') onSkip?.(top);
    else onPrimary(top);
  };
  const fling = (side: Side) => {
    x.set(withTiming(side === 'left' ? -width * 1.4 : width * 1.4, { duration: 220 }, (done) => {
      if (done) runOnJS(finish)(side);
    }));
  };
  const open = () => { if (top) onOpen(top); };

  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-18, 18])
    .onUpdate((e) => { x.set(e.translationX); y.set(e.translationY * 0.15); })
    .onEnd((e) => {
      const threshold = width * 0.28;
      if (e.translationX < -threshold || e.velocityX < -900) {
        x.set(withTiming(-width * 1.4, { duration: 200 }, (done) => { if (done) runOnJS(finish)('left'); }));
      } else if (e.translationX > threshold || e.velocityX > 900) {
        x.set(withTiming(width * 1.4, { duration: 200 }, (done) => { if (done) runOnJS(finish)('right'); }));
      } else {
        x.set(withSpring(0));
        y.set(withSpring(0));
      }
    });
  const tap = Gesture.Tap().maxDuration(250).onEnd((_e, success) => { if (success) runOnJS(open)(); });
  const gesture = Gesture.Race(pan, tap);

  const topStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() },
      { rotate: `${interpolate(x.get(), [-width, 0, width], [-12, 0, 12])}deg` }],
  }));
  const nextStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(Math.abs(x.get()), [0, width * 0.5], [0.94, 1], 'clamp') }],
    opacity: interpolate(Math.abs(x.get()), [0, width * 0.5], [0.6, 1], 'clamp'),
  }));
  const skipBadge = useAnimatedStyle(() => ({ opacity: interpolate(x.get(), [-width * 0.3, -20], [1, 0], 'clamp') }));
  const primaryBadge = useAnimatedStyle(() => ({ opacity: interpolate(x.get(), [20, width * 0.3], [0, 1], 'clamp') }));

  if (!top) {
    return <View style={{ gap: 12 }}>
      {emptyState}
      {skipped.length ? <Pressable accessibilityRole="button" onPress={() => setSkipped([])} style={{ alignSelf: 'center', padding: 10 }}>
        <Text variant="callout" color="primary">Show skipped cards again</Text>
      </Pressable> : null}
    </View>;
  }
  const primary = primaryFor(top);
  const round = (size: number, bg: string) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center' as const,
    justifyContent: 'center' as const, backgroundColor: bg, borderWidth: 1, borderColor: colors.border });

  return <View style={{ gap: 14 }}>
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {next ? <Animated.View pointerEvents="none" style={[{ position: 'absolute', inset: 0 }, nextStyle]}>{renderCard(next)}</Animated.View> : null}
      <GestureDetector gesture={gesture}>
        <Animated.View accessible accessibilityRole="button" accessibilityLabel="Card. Tap to open. Swipe left to skip, right for the main action."
          accessibilityActions={[{ name: 'activate' }, { name: 'decrement', label: 'Skip' }, { name: 'increment', label: primary.label }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'activate') open();
            else if (e.nativeEvent.actionName === 'decrement') finish('left');
            else finish('right');
          }}
          style={[{ position: 'absolute', inset: 0 }, topStyle]}>
          {renderCard(top)}
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 18, right: 18, paddingHorizontal: 12, paddingVertical: 6,
            borderRadius: 10, borderWidth: 2, borderColor: colors.danger, transform: [{ rotate: '12deg' }] }, skipBadge]}>
            <Text variant="subheading" style={{ color: colors.danger }}>SKIP</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 18, left: 18, paddingHorizontal: 12, paddingVertical: 6,
            borderRadius: 10, borderWidth: 2, borderColor: colors.success, transform: [{ rotate: '-12deg' }] }, primaryBadge]}>
            <Text variant="subheading" style={{ color: colors.success }}>{primary.label.toUpperCase()}</Text>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 22 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Skip" onPress={() => fling('left')} style={round(56, colors.surface)}>
        <Ionicons name="close" size={28} color={colors.danger} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Open details" onPress={open} style={round(46, colors.surface)}>
        <Ionicons name="expand-outline" size={20} color={colors.textSecondary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={primary.label} onPress={() => fling('right')} style={round(56, colors.primary)}>
        <Ionicons name={primary.icon} size={26} color={colors.onPrimary} />
      </Pressable>
    </View>
    <Text variant="caption" color="textTertiary" align="center">{visible.length} {visible.length === 1 ? 'card' : 'cards'} · swipe or tap the buttons</Text>
  </View>;
}
