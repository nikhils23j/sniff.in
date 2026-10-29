import { useEffect, useState, type ReactNode } from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { palette } from '@/theme';

import { INK } from './props';

/**
 * Cartoon cast for the Sniff.in story. One parametric `Person` (big head, rounded body, sticker outline)
 * and six presets: Guide (the user's namesake), Brother, Mother, Teacher, Friend1, Friend2.
 * Characters are drawn in a 120x200 viewBox; pass `height` in px (width follows).
 */
export const skinTones = {
  fair: '#F6D2AE',
  wheat: '#E7B488',
  tan: '#CF9468',
  brown: '#A9714A',
  deep: '#80512F',
} as const;

export const hairColors = { black: '#2B2331', brown: '#4B2E24', grey: '#7C7789' } as const;

export type Mood = 'happy' | 'excited' | 'wow' | 'calm' | 'wink';
export type Pose = 'down' | 'wave' | 'up' | 'out' | 'hold';
export type HairStyle = 'short' | 'curly' | 'bun' | 'braid' | 'long';
export type Outfit = 'kurta' | 'saree' | 'salwar' | 'uniform';

export type PersonProps = {
  /** Rendered height in px (default 230). Width = height * 0.6. */
  height?: number;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  outfit: Outfit;
  /** Main garment (tunic / saree / shirt). */
  top: string;
  /** Trim: kurta placket & hem, saree blouse, dupatta, tie. */
  accent: string;
  /** Trousers / churidar / saree border. */
  bottom?: string;
  mood?: Mood;
  /** Mouth flaps open and closed. */
  talking?: boolean;
  /** Pose of the arm on the viewer's left / right. */
  leftPose?: Pose;
  rightPose?: Pose;
  glasses?: boolean;
  bindi?: boolean;
  earrings?: boolean;
  /** Nehru-jacket colour over a kurta. */
  vest?: string;
  /** Blink / wave / talk. Turn off for reduce-motion. */
  animate?: boolean;
  /** Drawn on top of the arms, in 120x200 coordinates. */
  children?: ReactNode;
};

const SW = 3;
const LINE = { stroke: INK, strokeWidth: SW, strokeLinejoin: 'round', strokeLinecap: 'round' } as const;

/** Viewer-right arm geometry; the left arm mirrors it. [controlX, controlY, endX, endY] */
const ARMS: Record<Exclude<Pose, 'wave'>, [number, number, number, number]> = {
  down: [97, 128, 95, 152],
  up: [103, 96, 99, 68],
  out: [101, 114, 115, 122],
  hold: [94, 131, 66, 132],
};
const WAVE: [number, number, number, number][] = [
  [102, 96, 97, 70],
  [107, 99, 111, 76],
];

function Arm({ side, pose, tick, sleeve, skin }: { side: 'l' | 'r'; pose: Pose; tick: number; sleeve: string; skin: string }) {
  const g = pose === 'wave' ? WAVE[tick % 2] : ARMS[pose];
  const mx = (x: number) => (side === 'r' ? x : 120 - x);
  const d = `M ${mx(82)} 110 Q ${mx(g[0])} ${g[1]} ${mx(g[2])} ${g[3]}`;
  return (
    <G>
      <Path d={d} stroke={INK} strokeWidth={16} strokeLinecap="round" fill="none" />
      <Path d={d} stroke={sleeve} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Circle cx={mx(g[2])} cy={g[3]} r={6.8} fill={skin} stroke={INK} strokeWidth={2.6} />
    </G>
  );
}

function Eyes({ mood, blink }: { mood: Mood; blink: boolean }) {
  const eye = (x: number, kind: 'dot' | 'big' | 'wow' | 'arc' | 'line') => {
    switch (kind) {
      case 'line':
        return <Path key={x} d={`M ${x - 4.5} 63 L ${x + 4.5} 63`} stroke={INK} strokeWidth={3} strokeLinecap="round" />;
      case 'arc':
        return <Path key={x} d={`M ${x - 5.5} 64 Q ${x} 55 ${x + 5.5} 64`} stroke={INK} strokeWidth={3.2} strokeLinecap="round" fill="none" />;
      case 'wow':
        return (
          <G key={x}>
            <Circle cx={x} cy={62} r={6} fill={palette.white} stroke={INK} strokeWidth={2.5} />
            <Circle cx={x} cy={62} r={2.8} fill={INK} />
          </G>
        );
      case 'big':
        return (
          <G key={x}>
            <Ellipse cx={x} cy={62} rx={4.6} ry={5.6} fill={INK} />
            <Circle cx={x - 1.5} cy={59.8} r={1.7} fill={palette.white} />
          </G>
        );
      default:
        return (
          <G key={x}>
            <Ellipse cx={x} cy={62} rx={3.8} ry={4.6} fill={INK} />
            <Circle cx={x - 1.2} cy={60.4} r={1.3} fill={palette.white} />
          </G>
        );
    }
  };
  const open = mood === 'excited' ? 'big' : mood === 'wow' ? 'wow' : 'dot';
  if (mood === 'calm') return <G>{eye(46, 'arc')}{eye(74, 'arc')}</G>;
  if (mood === 'wink') return <G>{eye(46, blink ? 'line' : 'dot')}{eye(74, 'arc')}</G>;
  const kind = blink && open !== 'wow' ? 'line' : open;
  return <G>{eye(46, kind)}{eye(74, kind)}</G>;
}

function Mouth({ mood, open }: { mood: Mood; open: boolean }) {
  const red = '#C62848';
  if (mood === 'wow') return <Ellipse cx={60} cy={80} rx={5.2} ry={6.5} fill={red} stroke={INK} strokeWidth={2.5} />;
  if (open || mood === 'excited') {
    return (
      <G>
        <Path d="M50 74 Q60 76 70 74 Q69 90 60 90 Q51 90 50 74 Z" fill={red} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
        <Ellipse cx={60} cy={86} rx={4.4} ry={2.6} fill={palette.rani500} />
      </G>
    );
  }
  return <Path d="M51 76 Q60 86 69 76" stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" />;
}

function Brows({ mood }: { mood: Mood }) {
  const y = mood === 'excited' || mood === 'wow' ? 44 : 49;
  const tilt = mood === 'calm' ? 1 : 0;
  return (
    <G>
      <Path d={`M 39 ${y + 1 + tilt} Q 46 ${y - 3} 53 ${y + 1}`} stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      <Path d={`M 67 ${y + 1} Q 74 ${y - 3} 81 ${y + 1 + tilt}`} stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none" />
    </G>
  );
}

function BackHair({ style, hair }: { style: HairStyle; hair: string }) {
  if (style === 'bun') return <Circle cx={60} cy={22} r={14} fill={hair} {...LINE} />;
  if (style === 'braid') return <Ellipse cx={60} cy={58} rx={37} ry={36} fill={hair} {...LINE} />;
  if (style === 'long') {
    return <Path d="M23 60 Q16 124 28 156 L92 156 Q104 124 97 60 Z" fill={hair} {...LINE} />;
  }
  return null;
}

const CURLS: [number, number, number][] = [[33, 44, 10], [46, 33, 11], [60, 29, 11], [74, 33, 11], [87, 44, 10], [27, 57, 8], [93, 57, 8]];

function FrontHair({ style, hair }: { style: HairStyle; hair: string }) {
  if (style === 'curly') {
    return (
      <G>
        {CURLS.map(([x, y, r]) => <Circle key={`s${x}`} cx={x} cy={y} r={r} fill={hair} stroke={INK} strokeWidth={6} />)}
        {CURLS.map(([x, y, r]) => <Circle key={`f${x}`} cx={x} cy={y} r={r} fill={hair} />)}
      </G>
    );
  }
  if (style === 'short') {
    return (
      <G>
        <Path d="M25 62 C19 33 40 23 60 23 C82 23 101 34 95 62 C92 54 90 48 84 44 C74 52 58 50 48 42 C42 50 32 54 25 62 Z" fill={hair} {...LINE} />
        <Path d="M68 26 Q78 18 86 26" stroke={hair} strokeWidth={6} strokeLinecap="round" fill="none" />
      </G>
    );
  }
  return (
    <G>
      <Path d="M25 64 C17 34 40 22 60 22 C80 22 103 34 95 64 C90 50 76 42 60 38 C44 42 30 50 25 64 Z" fill={hair} {...LINE} />
      <Path d="M60 23 L60 38" stroke={INK} strokeWidth={2} opacity={0.45} />
    </G>
  );
}

function Braid({ hair }: { hair: string }) {
  return (
    <G>
      {[110, 125, 140, 155].map((y, i) => (
        <Ellipse key={y} cx={29 + (i % 2 ? 1 : -1)} cy={y} rx={7.5} ry={9.5} fill={hair} {...LINE} />
      ))}
      <Circle cx={29} cy={166} r={5.5} fill={palette.rani500} {...LINE} strokeWidth={2.4} />
      <Ellipse cx={29} cy={176} rx={5} ry={6.5} fill={hair} {...LINE} strokeWidth={2.4} />
    </G>
  );
}

type Body = { top: string; accent: string; bottom: string; skin: string; outfit: Outfit; vest?: string };

function Legs({ bottom, shoe, y = 146, h = 40, narrow = false }: { bottom: string; shoe: string; y?: number; h?: number; narrow?: boolean }) {
  const w = narrow ? 13 : 16;
  return (
    <G>
      {[43, 61].map((x) => (
        <Rect key={x} x={narrow ? x + 1 : x} y={y} width={w} height={h} rx={6} fill={bottom} {...LINE} />
      ))}
      <Ellipse cx={51} cy={190} rx={11.5} ry={6.5} fill={shoe} {...LINE} />
      <Ellipse cx={69} cy={190} rx={11.5} ry={6.5} fill={shoe} {...LINE} />
    </G>
  );
}

function Clothes({ top, accent, bottom, skin, outfit, vest }: Body) {
  if (outfit === 'saree') {
    return (
      <G>
        <Path d="M38 112 L82 112 L102 188 Q60 200 18 188 Z" fill={top} {...LINE} />
        <Path d="M54 130 Q52 160 47 190 M66 130 Q68 160 73 190" stroke={INK} strokeWidth={2} opacity={0.22} fill="none" />
        <Path d="M20.5 181 Q60 193 99.5 181" stroke={bottom} strokeWidth={5.5} fill="none" strokeLinecap="round" />
        <Ellipse cx={46} cy={194} rx={8} ry={4.5} fill={bottom} {...LINE} strokeWidth={2.4} />
        <Ellipse cx={74} cy={194} rx={8} ry={4.5} fill={bottom} {...LINE} strokeWidth={2.4} />
        <Path d="M40 107 Q60 99 80 107 L79 129 Q60 134 41 129 Z" fill={accent} {...LINE} />
        <Path d="M50 102 Q60 119 70 102 Z" fill={skin} {...LINE} strokeWidth={2.4} />
        <Path d="M38 106 L55 103 L96 168 L72 174 Z" fill={top} {...LINE} />
        <Path d="M72 174 L96 168" stroke={bottom} strokeWidth={5.5} strokeLinecap="round" />
        <Circle cx={74} cy={146} r={2.4} fill={bottom} />
        <Circle cx={62} cy={128} r={2.4} fill={bottom} />
        <Circle cx={50} cy={112} r={2.4} fill={bottom} />
      </G>
    );
  }
  if (outfit === 'salwar') {
    return (
      <G>
        <Legs bottom={bottom} shoe={accent} y={158} h={28} narrow />
        <Path d="M38 106 Q60 99 82 106 L92 164 Q60 172 28 164 Z" fill={top} {...LINE} />
        <Path d="M36 160 Q60 168 84 160" stroke={accent} strokeWidth={4.5} fill="none" strokeLinecap="round" />
        <Path d="M52 102 Q60 116 68 102 Z" fill={skin} {...LINE} strokeWidth={2.4} />
        <Circle cx={60} cy={130} r={3} fill={accent} />
        <Circle cx={60} cy={141} r={2.2} fill={accent} />
      </G>
    );
  }
  if (outfit === 'uniform') {
    return (
      <G>
        <Legs bottom={bottom} shoe={palette.ink} />
        <Path d="M40 106 Q60 99 80 106 L85 152 L35 152 Z" fill={top} {...LINE} />
        <Path d="M50 102 L60 117 L70 102 Z" fill={skin} {...LINE} strokeWidth={2.4} />
        <Path d="M46 104 L59 119 L50 122 Z M74 104 L61 119 L70 122 Z" fill={top} {...LINE} strokeWidth={2.4} />
        <Path d="M57 118 L63 118 L65 140 L60 147 L55 140 Z" fill={accent} {...LINE} strokeWidth={2.4} />
        <Rect x={34} y={146} width={52} height={9} rx={3} fill={bottom} {...LINE} />
        <Circle cx={73} cy={128} r={4} fill={palette.marigold500} />
      </G>
    );
  }
  // kurta
  return (
    <G>
      <Legs bottom={bottom} shoe={accent} />
      <Path d="M38 106 Q60 99 82 106 L91 158 Q60 166 29 158 Z" fill={top} {...LINE} />
      <Path d="M30 152 Q60 161 90 152" stroke={accent} strokeWidth={4.5} fill="none" strokeLinecap="round" />
      <Path d="M52 102 Q60 124 68 102 Z" fill={skin} {...LINE} strokeWidth={2.4} />
      <Path d="M60 119 L60 154" stroke={accent} strokeWidth={3} />
      <Circle cx={60} cy={130} r={2.2} fill={palette.marigold500} />
      <Circle cx={60} cy={142} r={2.2} fill={palette.marigold500} />
      {vest ? (
        <G>
          <Path d="M38 107 L51 103 L56 126 L54 157 Q41 160 30 156 Z" fill={vest} {...LINE} strokeWidth={2.6} />
          <Path d="M82 107 L69 103 L64 126 L66 157 Q79 160 90 156 Z" fill={vest} {...LINE} strokeWidth={2.6} />
        </G>
      ) : null}
    </G>
  );
}

function Glasses() {
  return (
    <G>
      <Circle cx={46} cy={62} r={10.5} fill={palette.white} fillOpacity={0.35} stroke={INK} strokeWidth={2.8} />
      <Circle cx={74} cy={62} r={10.5} fill={palette.white} fillOpacity={0.35} stroke={INK} strokeWidth={2.8} />
      <Path d="M56.5 61 Q60 58 63.5 61 M35.5 60 L27 58 M84.5 60 L93 58" stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none" />
    </G>
  );
}

export function Person({
  height = 230, skin, hair, hairStyle, outfit, top, accent, bottom = palette.cream, mood = 'happy', talking = false,
  leftPose = 'down', rightPose = 'down', glasses, bindi, earrings, vest, animate = true, children,
}: PersonProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => setTick((t) => t + 1), 260);
    return () => clearInterval(id);
  }, [animate]);

  const blink = animate && tick % 13 === 12;
  const mouthOpen = animate && talking && tick % 2 === 0;
  const sleeve = outfit === 'saree' ? accent : top;

  return (
    <Svg width={height * 0.6} height={height} viewBox="0 0 120 200">
      {/* ground shadow */}
      <Ellipse cx={60} cy={195} rx={34} ry={4.5} fill={INK} opacity={0.14} />
      <BackHair style={hairStyle} hair={hair} />
      <Circle cx={25} cy={67} r={6.5} fill={skin} {...LINE} strokeWidth={2.6} />
      <Circle cx={95} cy={67} r={6.5} fill={skin} {...LINE} strokeWidth={2.6} />
      <Rect x={52} y={88} width={16} height={22} rx={6} fill={skin} {...LINE} />
      <Clothes top={top} accent={accent} bottom={bottom} skin={skin} outfit={outfit} vest={vest} />
      {outfit === 'salwar' ? (
        <G>
          <Path d="M36 108 Q60 132 86 110" stroke={INK} strokeWidth={14} strokeLinecap="round" fill="none" />
          <Path d="M38 110 Q26 134 32 166" stroke={INK} strokeWidth={14} strokeLinecap="round" fill="none" />
          <Path d="M36 108 Q60 132 86 110" stroke={accent} strokeWidth={8} strokeLinecap="round" fill="none" />
          <Path d="M38 110 Q26 134 32 166" stroke={accent} strokeWidth={8} strokeLinecap="round" fill="none" />
        </G>
      ) : null}
      {hairStyle === 'braid' ? <Braid hair={hair} /> : null}
      <Ellipse cx={60} cy={62} rx={35} ry={33} fill={skin} {...LINE} />
      <FrontHair style={hairStyle} hair={hair} />
      {earrings ? (
        <G>
          <Circle cx={24} cy={78} r={3.6} fill={palette.marigold500} stroke={INK} strokeWidth={1.8} />
          <Circle cx={96} cy={78} r={3.6} fill={palette.marigold500} stroke={INK} strokeWidth={1.8} />
        </G>
      ) : null}
      {bindi ? <Circle cx={60} cy={47} r={3.2} fill={palette.rani600} /> : null}
      <Circle cx={37} cy={75} r={5.5} fill={palette.rani500} opacity={0.22} />
      <Circle cx={83} cy={75} r={5.5} fill={palette.rani500} opacity={0.22} />
      <Brows mood={mood} />
      <Eyes mood={mood} blink={blink} />
      {glasses ? <Glasses /> : null}
      <Path d="M57.5 69 Q60 72.5 62.5 69" stroke={INK} strokeWidth={1.8} strokeLinecap="round" fill="none" opacity={0.55} />
      <Mouth mood={mood} open={mouthOpen} />
      <Arm side="l" pose={leftPose} tick={tick} sleeve={sleeve} skin={skin} />
      <Arm side="r" pose={rightPose} tick={tick} sleeve={sleeve} skin={skin} />
      {children}
    </Svg>
  );
}

/* ---------------------------------- cast ---------------------------------- */

type CastProps = Partial<PersonProps>;

/** The user's namesake: gender-neutral, short tufted hair, saffron kurta + violet vest (or school uniform). */
export function Guide({ uniform, ...p }: CastProps & { uniform?: boolean }) {
  return uniform ? (
    <Person
      skin={skinTones.wheat} hair={hairColors.black} hairStyle="short" outfit="uniform"
      top={palette.white} accent={palette.rani500} bottom="#3B4A9E" {...p}
    />
  ) : (
    <Person
      skin={skinTones.wheat} hair={hairColors.black} hairStyle="short" outfit="kurta"
      top={palette.saffron500} accent={palette.marigold500} bottom={palette.cream} vest={palette.violet600} {...p}
    />
  );
}

/** Arjun: curly hair, teal kurta. */
export function Brother(p: CastProps) {
  return (
    <Person
      skin={skinTones.tan} hair={hairColors.brown} hairStyle="curly" outfit="kurta"
      top={palette.teal500} accent={palette.marigold500} bottom={palette.cream} {...p}
    />
  );
}

/** Mother: bun, bindi, earrings, rani-pink saree. */
export function Mother(p: CastProps) {
  return (
    <Person
      skin={skinTones.tan} hair={hairColors.black} hairStyle="bun" outfit="saree"
      top={palette.rani500} accent={palette.violet600} bottom={palette.marigold500} bindi earrings {...p}
    />
  );
}

/** Ms. Iyer: glasses, peacock-blue saree, a stack of books. */
export function Teacher({ books = true, ...p }: CastProps & { books?: boolean }) {
  return (
    <Person
      skin={skinTones.brown} hair={hairColors.black} hairStyle="bun" outfit="saree"
      top={palette.peacock500} accent={palette.cream} bottom={palette.marigold500} glasses earrings
      leftPose={books ? 'hold' : 'down'} rightPose={books ? 'hold' : 'out'} {...p}>
      {books ? (
        <G>
          <Rect x={40} y={123} width={40} height={11} rx={3} fill={palette.rani500} {...LINE} strokeWidth={2.4} />
          <Rect x={43} y={113} width={34} height={10} rx={3} fill={palette.teal500} {...LINE} strokeWidth={2.4} />
          <Rect x={41} y={104} width={36} height={10} rx={3} fill={palette.violet600} {...LINE} strokeWidth={2.4} />
          <Circle cx={53} cy={133} r={6.8} fill={skinTones.brown} {...LINE} strokeWidth={2.6} />
          <Circle cx={67} cy={133} r={6.8} fill={skinTones.brown} {...LINE} strokeWidth={2.6} />
        </G>
      ) : null}
    </Person>
  );
}

/** Meera: long braid, violet salwar with a marigold dupatta. */
export function Friend1(p: CastProps) {
  return (
    <Person
      skin={skinTones.fair} hair={hairColors.black} hairStyle="braid" outfit="salwar"
      top={palette.violet500} accent={palette.marigold500} bottom={palette.rani500} earrings {...p}
    />
  );
}

/** Kabir: short hair, rani-pink kurta. */
export function Friend2(p: CastProps) {
  return (
    <Person
      skin={skinTones.deep} hair={hairColors.black} hairStyle="short" outfit="kurta"
      top={palette.rani500} accent={palette.saffron500} bottom={palette.cream} {...p}
    />
  );
}

export type CastId = 'guide' | 'brother' | 'mother' | 'teacher' | 'friend1' | 'friend2';

export const CAST_COMPONENTS = { guide: Guide, brother: Brother, mother: Mother, teacher: Teacher, friend1: Friend1, friend2: Friend2 } as const;
