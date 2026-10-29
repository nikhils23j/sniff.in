import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import { gradients } from '@/theme';

import { Brother, Friend1, Friend2, Guide, Mother, Teacher } from './characters';
import { INK, Kite, MarigoldGarland, QrSticker, Shield, Sparkle } from './props';

export type VignetteKind = 'friends' | 'servers' | 'safe';

/** Small decorative scene card (festive gradient, characters, stickers) for the pre-signup intro. */
export function Vignette({ kind, width, animate = true }: { kind: VignetteKind; width: number; animate?: boolean }) {
  const h = width * 0.62;
  const c = h * 0.78; // character height
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height: h, borderRadius: 28, overflow: 'hidden', borderWidth: 3, borderColor: INK }}>
      <LinearGradient
        colors={kind === 'friends' ? gradients.sunrise : kind === 'servers' ? gradients.peacock : gradients.holi}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View style={{ position: 'absolute', left: 0, top: -2 }}>
        <MarigoldGarland width={width} />
      </View>
      {kind === 'friends' ? (
        <>
          <Abs left={width * 0.04} top={h * 0.22}><Kite size={width * 0.1} /></Abs>
          <Abs left={width * 0.86} top={h * 0.3}><Sparkle size={width * 0.08} /></Abs>
          <Abs left={width * 0.08} bottom={4}><Friend1 height={c} animate={animate} mood="happy" rightPose="wave" /></Abs>
          <Abs left={width * 0.36} bottom={4}><Guide height={c * 1.06} animate={animate} mood="excited" leftPose="wave" /></Abs>
          <Abs left={width * 0.64} bottom={4}><Friend2 height={c} animate={animate} mood="wink" leftPose="up" /></Abs>
        </>
      ) : null}
      {kind === 'servers' ? (
        <>
          <Abs left={width * 0.06} bottom={4}><Brother height={c} animate={animate} mood="excited" rightPose="out" /></Abs>
          <Abs left={width * 0.34} top={h * 0.3}><QrSticker size={width * 0.2} /></Abs>
          <Abs left={width * 0.62} bottom={4}><Teacher height={c} animate={animate} books={false} mood="happy" leftPose="out" rightPose="wave" /></Abs>
        </>
      ) : null}
      {kind === 'safe' ? (
        <>
          <Abs left={width * 0.08} bottom={4}><Mother height={c} animate={animate} mood="happy" leftPose="wave" /></Abs>
          <Abs left={width * 0.42} top={h * 0.26}><Shield size={width * 0.15} /></Abs>
          <Abs left={width * 0.62} bottom={4}><Guide height={c} animate={animate} mood="calm" rightPose="up" /></Abs>
          <Abs left={width * 0.84} top={h * 0.34}><Sparkle size={width * 0.08} /></Abs>
        </>
      ) : null}
    </View>
  );
}

function Abs({ left, top, bottom, children }: { left: number; top?: number; bottom?: number; children: React.ReactNode }) {
  return <View style={{ position: 'absolute', left, top, bottom }}>{children}</View>;
}
