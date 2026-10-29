import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { PanResponder, Pressable, Text as RNText, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  FadeIn, FadeOut, LinearTransition, SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight, useAnimatedStyle,
  useSharedValue, withRepeat, withSequence, withTiming, ZoomIn, ZoomOut,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { fonts, palette, useTheme } from '@/theme';

import { Brother, Friend1, Friend2, Guide, Mother, Teacher } from './characters';
import { firstNameOf } from './name';
import { useReduceMotion } from './motion';
import { AvailableSticker, Background, Board, Books, Chai, Diya, INK, Kite, MarigoldGarland, QrSticker, Rangoli, Shield, Sparkle } from './props';
import { buildScenes, speakerName, type CastSlot, type Scene, type Sticker } from './scenes';

type Props = {
  /** Full display name; the guide uses the first word. Null/empty → neutral greeting. */
  displayName?: string | null;
  /** Called by "Get Started" and "Skip". */
  onFinish: () => void;
};

const BASE_H = 230;

/** Personalised cartoon walkthrough of Sniff.in. Scenes, cast and stickers come from `scenes.ts`. */
export function StoryPlayer({ displayName, onFinish }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const firstName = firstNameOf(displayName);
  const scenes = buildScenes(firstName);
  const [index, setIndex] = useState(0);
  const [area, setArea] = useState({ w: 0, h: 0 });

  const last = index === scenes.length - 1;
  const scene = scenes[index];

  const total = scenes.length;
  const go = (delta: number) => setIndex((i) => Math.min(total - 1, Math.max(0, i + delta)));

  // Swipe left = next, swipe right = back. Only claims clearly horizontal drags so taps still reach buttons.
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -50) go(1);
        else if (g.dx > 50) go(-1);
      },
    }),
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea((a) => (a.w === width && a.h === height ? a : { w: width, h: height }));
  };

  const ready = area.w > 0 && area.h > 0;
  const charH = Math.max(150, Math.min(BASE_H, area.h * 0.38, area.w * 0.64));
  const ground = 40 * Math.max(area.w / 360, area.h / 640);
  const speakerSlot = scene.cast.find((c) => c.id === scene.speaker);
  const speakerX = speakerSlot?.x ?? 0.5;
  const who = speakerName(scene.speaker, firstName);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View
        {...pan.panHandlers}
        onLayout={onLayout}
        style={{ flex: 1, overflow: 'hidden', borderBottomLeftRadius: 28, borderBottomRightRadius: 28, borderBottomWidth: 3, borderColor: INK, backgroundColor: palette.saffron100 }}>
        {ready ? (
          <>
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Animated.View key={scene.background} entering={FadeIn.duration(450)} exiting={FadeOut.duration(450)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                <Background kind={scene.background} />
              </Animated.View>
              {scene.stickers.filter((s) => s.behind).map((s) => (
                <StickerView key={`${scene.id}-${s.kind}-${s.x}`} s={s} area={area} charH={charH} ground={ground} reduce={reduce} />
              ))}
              {scene.cast.map((slot) => (
                <CastView key={slot.id} slot={slot} scene={scene} area={area} charH={charH} ground={ground} reduce={reduce} />
              ))}
              {scene.stickers.filter((s) => !s.behind).map((s) => (
                <StickerView key={`${scene.id}-${s.kind}-${s.x}`} s={s} area={area} charH={charH} ground={ground} reduce={reduce} />
              ))}
            </View>

            <Animated.View
              key={scene.id}
              entering={reduce ? FadeIn.duration(200) : ZoomIn.delay(250).springify().damping(16)}
              exiting={FadeOut.duration(120)}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${who} says: ${scene.line}`}
              accessibilityLiveRegion="polite"
              style={{ position: 'absolute', top: insets.top + 58, left: 16, right: 16 }}>
              <Bubble who={who} line={scene.line} tailX={Math.min(Math.max(speakerX * area.w - 16 - 10, 22), area.w - 32 - 46)} />
            </Animated.View>
          </>
        ) : null}

        <View style={{ position: 'absolute', top: insets.top + 10, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Story progress"
            accessibilityValue={{ min: 1, max: scenes.length, now: index + 1, text: `Scene ${index + 1} of ${scenes.length}` }}
            style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 14, paddingHorizontal: 10, height: 28, borderWidth: 2, borderColor: INK }}>
            {scenes.map((s, i) => (
              <View key={s.id} style={{ height: 8, width: i === index ? 20 : 8, borderRadius: 4, backgroundColor: i === index ? palette.violet600 : i < index ? palette.violet300 : palette.sand200 }} />
            ))}
          </View>
          {last ? (
            <View />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip story"
              hitSlop={10}
              onPress={onFinish}
              style={({ pressed }) => ({ height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: pressed ? palette.sand200 : 'rgba(255,255,255,0.9)', borderWidth: 2, borderColor: INK, alignItems: 'center', justifyContent: 'center' })}>
              <RNText style={{ fontFamily: fonts.bold, fontSize: 13, color: palette.ink }}>Skip</RNText>
            </Pressable>
          )}
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: Math.max(insets.bottom, 16) }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityState={{ disabled: index === 0 }}
          disabled={index === 0}
          hitSlop={6}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            go(-1);
          }}
          style={({ pressed }) => ({
            width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface, borderWidth: 1.5, borderColor: t.colors.borderStrong,
            opacity: index === 0 ? 0.35 : 1,
          })}>
          <Ionicons name="chevron-back" size={24} color={t.colors.text} />
        </Pressable>
        <Button
          title={last ? 'Get Started' : 'Next'}
          size="lg"
          iconRight={last ? 'checkmark-circle' : 'arrow-forward'}
          style={{ flex: 1 }}
          onPress={() => (last ? onFinish() : go(1))}
        />
      </View>
    </View>
  );
}

function Bubble({ who, line, tailX }: { who: string; line: string; tailX: number }) {
  return (
    <View>
      <View style={{ backgroundColor: palette.white, borderRadius: 22, borderWidth: 3, borderColor: INK, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, gap: 4 }}>
        <RNText style={{ fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 0.6, color: palette.violet600, textTransform: 'uppercase' }} numberOfLines={1}>
          {who}
        </RNText>
        <RNText maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.semibold, fontSize: 17, lineHeight: 24, color: palette.ink }}>
          {line}
        </RNText>
      </View>
      <View style={{ position: 'absolute', bottom: -9, left: tailX, width: 18, height: 18, backgroundColor: palette.white, borderRightWidth: 3, borderBottomWidth: 3, borderColor: INK, transform: [{ rotate: '45deg' }], borderBottomRightRadius: 4 }} />
    </View>
  );
}

function Bob({ children, phase, active }: { children: React.ReactNode; phase: number; active: boolean }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      y.value = 0;
      return;
    }
    y.value = withRepeat(withSequence(withTiming(-5, { duration: 620 + phase * 90 }), withTiming(0, { duration: 620 + phase * 90 })), -1);
  }, [active, phase, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function CastView({ slot, scene, area, charH, ground, reduce }: { slot: CastSlot; scene: Scene; area: { w: number; h: number }; charH: number; ground: number; reduce: boolean }) {
  const h = charH * (slot.scale ?? 1);
  const w = h * 0.6;
  const entering = reduce
    ? FadeIn.duration(250)
    : slot.enter === 'left' ? SlideInLeft.duration(750).springify().damping(18)
    : slot.enter === 'right' ? SlideInRight.duration(750).springify().damping(18)
    : ZoomIn.springify().damping(12);
  const exiting = reduce
    ? FadeOut.duration(200)
    : slot.exit === 'left' ? SlideOutLeft.duration(450)
    : slot.exit === 'right' ? SlideOutRight.duration(450)
    : ZoomOut.duration(250);
  const talking = scene.speaker === slot.id;
  const common = { height: h, animate: !reduce, talking, mood: slot.mood, leftPose: slot.leftPose, rightPose: slot.rightPose };
  const phase = ['guide', 'brother', 'mother', 'teacher', 'friend1', 'friend2'].indexOf(slot.id);

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      layout={reduce ? undefined : LinearTransition.springify().damping(20)}
      style={{ position: 'absolute', left: slot.x * area.w - w / 2, bottom: ground, width: w, height: h }}>
      <Bob active={!reduce} phase={phase % 3}>
        {slot.id === 'guide' ? <Guide {...common} uniform={slot.uniform} /> : null}
        {slot.id === 'brother' ? <Brother {...common} /> : null}
        {slot.id === 'mother' ? <Mother {...common} /> : null}
        {slot.id === 'teacher' ? <Teacher {...common} books={slot.books ?? true} /> : null}
        {slot.id === 'friend1' ? <Friend1 {...common} /> : null}
        {slot.id === 'friend2' ? <Friend2 {...common} /> : null}
      </Bob>
    </Animated.View>
  );
}

function StickerArt({ s, size }: { s: Sticker; size: number }) {
  switch (s.kind) {
    case 'diya': return <Diya size={size} />;
    case 'rangoli': return <Rangoli size={size} />;
    case 'kite': return <Kite size={size} color={s.color} />;
    case 'chai': return <Chai size={size} />;
    case 'qr': return <QrSticker size={size} />;
    case 'available': return <AvailableSticker width={size} />;
    case 'shield': return <Shield size={size} />;
    case 'sparkle': return <Sparkle size={size} />;
    case 'books': return <Books size={size} />;
    case 'boardTalk': return <Board width={size} variant="talk" />;
    case 'boardPlan': return <Board width={size} variant="plan" />;
    case 'garland': return <MarigoldGarland width={size} />;
  }
}

function StickerView({ s, area, charH, ground, reduce }: { s: Sticker; area: { w: number; h: number }; charH: number; ground: number; reduce: boolean }) {
  const isGarland = s.kind === 'garland';
  const size = isGarland ? area.w : s.size * charH;
  const entering = reduce ? FadeIn.duration(250) : isGarland ? FadeIn.duration(500) : ZoomIn.delay(s.delay ?? 300).springify().damping(11);
  const pos = isGarland
    ? { top: 0, left: 0 }
    : { bottom: ground + s.lift * charH, left: s.x * area.w - size / 2 };
  return (
    <Animated.View entering={entering} exiting={FadeOut.duration(150)} style={[{ position: 'absolute', width: size }, pos]}>
      <View style={s.flat ? { transform: [{ scaleY: 0.32 }] } : undefined}>
        <StickerArt s={s} size={size} />
      </View>
    </Animated.View>
  );
}
