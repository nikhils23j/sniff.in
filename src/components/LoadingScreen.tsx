import { StatusBar } from 'expo-status-bar';
import { useEffect, type ComponentProps } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';

import { Logo } from '@/components/ui';
import { Diya, DiyaFlame, Rangoli } from '@/components/story/props';
import { useReduceMotion } from '@/components/story/motion';
import { fonts, palette } from '@/theme';

/**
 * Branded loading screen shown while the session and profile load (the native splash hides as soon as fonts are ready).
 * Four faith symbols appear one after another, each with identical size, timing and neutral styling, to say
 * "for everyone". They are decorative, never tied to a user. Plain Unicode glyphs rendered in the system font.
 */
const SYMBOLS = [
  { glyph: 'ॐ', label: 'Om' },
  { glyph: '☪︎', label: 'Star and crescent' },
  { glyph: '☬', label: 'Khanda' },
  { glyph: '✝︎', label: 'Cross' },
] as const;

// Four symbols, equal time each; one full cycle fits the minimum cold-start display (MIN_BRAND_MS in _layout).
const SYMBOL_MS = 400;
const CIRCLE = 104;

function SymbolGlyph({ glyph }: { glyph: string }) {
  return (
    <RNText
      allowFontScaling={false}
      style={{ fontFamily: undefined, fontSize: 50, lineHeight: 60, color: palette.violet600, textAlign: 'center', includeFontPadding: false }}>
      {glyph}
    </RNText>
  );
}

function SymbolCircle({ children, style }: { children: React.ReactNode; style?: ComponentProps<typeof Animated.View>['style'] }) {
  return (
    <Animated.View
      style={[{ width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, backgroundColor: palette.violet100, alignItems: 'center', justifyContent: 'center' }, style]}>
      {children}
    </Animated.View>
  );
}

function AnimatedSymbol({ index, p, glyph }: { index: number; p: SharedValue<number>; glyph: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [index, index + 0.22, index + 0.8, index + 1], [0, 1, 1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(p.value, [index, index + 0.22, index + 1], [0.9, 1, 1], Extrapolation.CLAMP) }],
  }));
  return (
    <SymbolCircle style={[StyleSheet.absoluteFill, style]}>
      <SymbolGlyph glyph={glyph} />
    </SymbolCircle>
  );
}

function FlickerDiya({ delay }: { delay: number }) {
  const f = useSharedValue(0);
  useEffect(() => {
    f.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 280 + (delay % 3) * 60 }), withTiming(0, { duration: 340 })), -1),
    );
  }, [delay, f]);
  const flame = useAnimatedStyle(() => ({
    opacity: 0.8 + f.value * 0.2,
    transform: [{ translateY: 18 }, { scaleY: 0.92 + f.value * 0.14 }, { scaleX: 1.04 - f.value * 0.1 }, { translateY: -18 }],
  }));
  return (
    <View style={{ width: 38, height: 38 }}>
      <Diya size={38} flame={false} />
      <Animated.View style={[StyleSheet.absoluteFill, flame]}>
        <DiyaFlame size={38} />
      </Animated.View>
    </View>
  );
}

export function LoadingScreen() {
  const reduce = useReduceMotion();
  const p = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    if (reduce) return;
    p.value = 0;
    p.value = withRepeat(withTiming(SYMBOLS.length, { duration: SYMBOLS.length * SYMBOL_MS, easing: Easing.linear }), -1);
    spin.value = withRepeat(withTiming(360, { duration: 26000, easing: Easing.linear }), -1);
  }, [reduce, p, spin]);

  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading Sniff.in"
      style={{ flex: 1, backgroundColor: palette.cream, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
      <StatusBar style="dark" />
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Logo width={190} />
        <RNText style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: palette.slate600, textAlign: 'center' }}>
          Skip the Introduction. Start the Connection.
        </RNText>
      </View>

      <View style={{ marginTop: 36, width: 232, height: 232, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute', opacity: 0.9 }, ring]}>
          <Rangoli size={232} />
        </Animated.View>
        <View style={{ width: CIRCLE + 22, height: CIRCLE + 22, borderRadius: (CIRCLE + 22) / 2, backgroundColor: palette.cream, alignItems: 'center', justifyContent: 'center' }}>
          {reduce ? null : (
            <View style={{ width: CIRCLE, height: CIRCLE }}>
              {SYMBOLS.map((s, i) => (
                <AnimatedSymbol key={s.label} index={i} p={p} glyph={s.glyph} />
              ))}
            </View>
          )}
        </View>
      </View>

      {reduce ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          {SYMBOLS.map((s) => (
            <SymbolCircle key={s.label} style={{ width: 64, height: 64, borderRadius: 32 }}>
              <RNText allowFontScaling={false} style={{ fontFamily: undefined, fontSize: 32, lineHeight: 40, color: palette.violet600, textAlign: 'center', includeFontPadding: false }}>
                {s.glyph}
              </RNText>
            </SymbolCircle>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 14, marginTop: 24, alignItems: 'flex-end' }}>
        {[0, 140, 60, 200, 100].map((d, i) =>
          reduce ? <Diya key={i} size={38} /> : <FlickerDiya key={i} delay={d} />,
        )}
      </View>

      <RNText style={{ marginTop: 20, fontFamily: fonts.medium, fontSize: 13, color: palette.slate400 }}>For everyone.</RNText>
    </View>
  );
}
