import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

import { palette, useTheme } from '@/theme';

/** The Sniff.in radio-wave mark (dot + arcs). `live` adds a slow pulse for "Available". */
export function Waves({ size = 48, live = false, mono }: { size?: number; live?: boolean; mono?: string }) {
  const { colors } = useTheme();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!live) return;
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);

  const c = 50;
  const arc = (r: number, a0: number, a1: number) => {
    const rad = (d: number) => (d * Math.PI) / 180;
    const x0 = c + r * Math.cos(rad(a0));
    const y0 = c + r * Math.sin(rad(a0));
    const x1 = c + r * Math.cos(rad(a1));
    const y1 = c + r * Math.sin(rad(a1));
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const left = mono ?? colors.primary;
  const right = mono ?? palette.teal500;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {live ? (
        <Animated.View
          style={{
            position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: palette.teal500,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.25] }) }],
          }}
        />
      ) : null}
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={c} cy={c} r={6.5} fill={left} />
        <Path d={arc(17, 140, 220)} stroke={left} strokeWidth={6} fill="none" strokeLinecap="round" />
        <Path d={arc(27, 135, 225)} stroke={left} strokeWidth={6} fill="none" strokeLinecap="round" />
        <Path d={arc(17, -40, 40)} stroke={right} strokeWidth={6} fill="none" strokeLinecap="round" />
        <Path d={arc(27, -45, 45)} stroke={right} strokeWidth={6} fill="none" strokeLinecap="round" />
        <Path d={arc(37, -50, 50)} stroke={right} strokeWidth={6} fill="none" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

/** "sniff.in" wordmark with the gradient wave accent, drawn in SVG so it is crisp at any size. */
export function Logo({ width = 140, inverse }: { width?: number; inverse?: boolean }) {
  const height = width * 0.36;
  const ink = inverse ? '#FFFFFF' : palette.indigo700;
  return (
    <View accessibilityRole="image" accessibilityLabel="Sniff.in">
      <Svg width={width} height={height} viewBox="0 0 200 72">
        <Defs>
          <LinearGradient id="wave" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={palette.violet500} />
            <Stop offset="1" stopColor={palette.teal500} />
          </LinearGradient>
        </Defs>
        <SvgText x="0" y="62" fill={ink} fontSize="56" fontWeight="800" fontFamily="PlusJakartaSans_800ExtraBold" letterSpacing="-1.5">
          sniff.in
        </SvgText>
        <Path d="M 166 20 A 14 14 0 0 1 180 6" stroke="url(#wave)" strokeWidth="5" fill="none" strokeLinecap="round" />
        <Path d="M 166 28 A 24 24 0 0 1 190 4" stroke="url(#wave)" strokeWidth="5" fill="none" strokeLinecap="round" />
      </Svg>
    </View>
  );
}
