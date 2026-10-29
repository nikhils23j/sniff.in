import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { fonts, palette } from '@/theme';

/**
 * Story props, stickers and backgrounds. Flat vector shapes with a shared thick "sticker" outline.
 * Every component is purely decorative (hidden from accessibility by the callers).
 */
export const INK = palette.indigo700;
const W = 3; // outline weight shared by everything

type SizeProps = { size?: number };

/** Clay diya. `flame={false}` draws only the bowl (used by the flickering loader). */
export function Diya({ size = 60, flame = true }: SizeProps & { flame?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60">
      <Path d="M5 34 L55 34 Q52 56 30 56 Q8 56 5 34 Z" fill={palette.saffron500} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <Ellipse cx={30} cy={34} rx={25} ry={4.5} fill={palette.marigold100} stroke={INK} strokeWidth={W} />
      <Path d="M14 44 Q30 51 46 44" stroke={palette.marigold500} strokeWidth={3} fill="none" strokeLinecap="round" />
      {flame ? <DiyaFlameShape /> : null}
    </Svg>
  );
}

function DiyaFlameShape() {
  return (
    <G>
      <Circle cx={30} cy={22} r={16} fill={palette.marigold500} opacity={0.22} />
      <Path d="M30 6 C41 17 41 28 30 33 C19 28 19 17 30 6 Z" fill={palette.marigold500} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <Path d="M30 16 C35 21 35 27 30 30 C25 27 25 21 30 16 Z" fill={palette.marigold100} />
    </G>
  );
}

/** Only the flame, same canvas as `Diya` (so it can be layered and animated on top of the bowl). */
export function DiyaFlame({ size = 60 }: SizeProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60">
      <DiyaFlameShape />
    </Svg>
  );
}

const PETAL_COLORS = [palette.rani500, palette.saffron500, palette.teal500, palette.violet600] as const;

/** Rangoli mandala. Also used (rotating) by the loading screen. */
export function Rangoli({ size = 100, outline = true }: SizeProps & { outline?: boolean }) {
  const sw = outline ? 2.5 : 0;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {Array.from({ length: 12 }, (_, k) => (
        <Circle
          key={`d${k}`}
          cx={50 + 46 * Math.cos((k * Math.PI) / 6)}
          cy={50 + 46 * Math.sin((k * Math.PI) / 6)}
          r={2.6}
          fill={k % 2 ? palette.marigold500 : palette.rani500}
        />
      ))}
      {Array.from({ length: 12 }, (_, k) => (
        <G key={`p${k}`} rotation={k * 30} origin="50, 50">
          <Path
            d="M50 50 C43 40 44 24 50 17 C56 24 57 40 50 50 Z"
            fill={PETAL_COLORS[k % PETAL_COLORS.length]}
            stroke={INK}
            strokeWidth={sw}
            strokeLinejoin="round"
            opacity={outline ? 1 : 0.9}
          />
        </G>
      ))}
      <Circle cx={50} cy={50} r={11} fill={palette.marigold500} stroke={INK} strokeWidth={sw} />
      <Circle cx={50} cy={50} r={5} fill={palette.violet700} />
    </Svg>
  );
}

export function Kite({ size = 60, color = palette.rani500, color2 = palette.saffron500 }: SizeProps & { color?: string; color2?: string }) {
  return (
    <Svg width={size} height={size * (100 / 60)} viewBox="0 0 60 100">
      <Path d="M30 62 Q18 72 30 80 Q42 88 30 98" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <Ellipse cx={23} cy={74} rx={5} ry={3} fill={palette.teal500} stroke={INK} strokeWidth={2} rotation={-30} origin="23, 74" />
      <Ellipse cx={36} cy={86} rx={5} ry={3} fill={palette.marigold500} stroke={INK} strokeWidth={2} rotation={30} origin="36, 86" />
      <Path d="M30 4 L54 30 L30 62 L6 30 Z" fill={color} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <Path d="M30 4 L54 30 L30 30 Z" fill={color2} />
      <Path d="M30 62 L6 30 L30 30 Z" fill={color2} />
      <Path d="M30 4 L54 30 L30 62 L6 30 Z" fill="none" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <Path d="M30 4 L30 62 M6 30 L54 30" stroke={INK} strokeWidth={2} />
    </Svg>
  );
}

/** Sagging marigold garland (toran). */
export function MarigoldGarland({ width = 360 }: { width?: number }) {
  const flowers = Array.from({ length: 15 }, (_, i) => {
    const t = i / 14;
    return { x: 360 * t, y: 6 * (1 - t) ** 2 + 62 * 2 * (1 - t) * t + 6 * t ** 2, i };
  });
  return (
    <Svg width={width} height={width * (60 / 360)} viewBox="0 0 360 60">
      <Path d="M0 6 Q180 62 360 6" stroke={INK} strokeWidth={2.5} fill="none" />
      {flowers.map((f) => (
        <G key={f.i}>
          <Circle cx={f.x} cy={f.y + 5} r={9} fill={f.i % 2 ? palette.saffron500 : palette.marigold500} stroke={INK} strokeWidth={2} />
          <Circle cx={f.x} cy={f.y + 5} r={3.4} fill={palette.saffron600} />
        </G>
      ))}
    </Svg>
  );
}

export function Chai({ size = 60 }: SizeProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60">
      <Path d="M25 17 Q20 11 25 5 M36 19 Q31 13 36 7" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.55} />
      <Path d="M47 28 Q58 28 56 38 Q54 45 45 43" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
      <Path d="M11 24 L14 44 Q30 55 46 44 L49 24 Z" fill={palette.white} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <Ellipse cx={30} cy={24} rx={19} ry={4.5} fill="#C98A55" stroke={INK} strokeWidth={W} />
      <Path d="M17 34 Q30 40 43 34" stroke={palette.rani500} strokeWidth={3} fill="none" strokeLinecap="round" />
      <Ellipse cx={30} cy={52} rx={22} ry={4} fill={palette.saffron100} stroke={INK} strokeWidth={W} />
    </Svg>
  );
}

export function Books({ size = 80 }: SizeProps) {
  return (
    <Svg width={size} height={size * 0.75} viewBox="0 0 80 60">
      <Rect x={6} y={38} width={66} height={16} rx={4} fill={palette.rani500} stroke={INK} strokeWidth={W} />
      <Rect x={10} y={43} width={52} height={3} rx={1.5} fill={palette.white} opacity={0.8} />
      <Rect x={12} y={22} width={56} height={16} rx={4} fill={palette.teal500} stroke={INK} strokeWidth={W} />
      <Rect x={16} y={27} width={40} height={3} rx={1.5} fill={palette.white} opacity={0.8} />
      <Rect x={4} y={6} width={52} height={16} rx={4} fill={palette.violet600} stroke={INK} strokeWidth={W} />
      <Rect x={9} y={11} width={30} height={3} rx={1.5} fill={palette.marigold500} />
    </Svg>
  );
}

const QR_ON = [
  [3, 0], [5, 0], [4, 1], [3, 2], [6, 2], [0, 3], [2, 3], [4, 3], [5, 4], [3, 4], [6, 5], [4, 6], [5, 6], [2, 5], [0, 5],
];

export function QrSticker({ size = 70 }: SizeProps) {
  const u = 7;
  const finder = (x: number, y: number) => (
    <G key={`${x}-${y}`}>
      <Rect x={x} y={y} width={3 * u} height={3 * u} fill="none" stroke={INK} strokeWidth={3} />
      <Rect x={x + u} y={y + u} width={u} height={u} fill={INK} />
    </G>
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 70 70">
      <Rect x={2} y={2} width={66} height={66} rx={12} fill={palette.white} stroke={INK} strokeWidth={W} />
      <G x={10} y={10}>
        {finder(1, 1)}
        {finder(35, 1)}
        {finder(1, 35)}
        {QR_ON.map(([c, r]) => (
          <Rect key={`${c}${r}`} x={c * 7 + 1} y={r * 7 + 1} width={5.5} height={5.5} rx={1} fill={INK} opacity={c < 3 && r < 3 ? 0 : 1} />
        ))}
      </G>
      <Rect x={8} y={33} width={54} height={4} rx={2} fill={palette.teal500} opacity={0.85} />
    </Svg>
  );
}

/** "Available" toggle sticker (switched on). */
export function AvailableSticker({ width = 130 }: { width?: number }) {
  return (
    <Svg width={width} height={width * (46 / 130)} viewBox="0 0 130 46">
      <Rect x={3} y={3} width={124} height={40} rx={20} fill={palette.leaf500} stroke={INK} strokeWidth={W} />
      <SvgText x={20} y={29} fill={palette.white} fontSize={15} fontWeight="800" fontFamily={fonts.extrabold}>
        Available
      </SvgText>
      <Circle cx={105} cy={23} r={13} fill={palette.white} stroke={INK} strokeWidth={W} />
    </Svg>
  );
}

export function Shield({ size = 60 }: SizeProps) {
  return (
    <Svg width={size} height={size * (70 / 60)} viewBox="0 0 60 70">
      <Path d="M30 4 L54 12 L54 34 Q54 56 30 66 Q6 56 6 34 L6 12 Z" fill={palette.teal500} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <Path d="M18 35 L27 44 L43 26" stroke={palette.white} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function Sparkle({ size = 30, color = palette.marigold500 }: SizeProps & { color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Path d="M20 2 Q22 18 38 20 Q22 22 20 38 Q18 22 2 20 Q18 18 20 2 Z" fill={color} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
    </Svg>
  );
}

/** Chalkboard in a wooden frame. `talk` = Open to Talk interests; `plan` = an Activity post with I'm in / I'm not in. */
export function Board({ width = 200, variant }: { width?: number; variant: 'talk' | 'plan' }) {
  return (
    <Svg width={width} height={width * 0.7} viewBox="0 0 200 140">
      <Rect x={3} y={3} width={194} height={126} rx={12} fill="#B8794A" stroke={INK} strokeWidth={W} />
      <Rect x={12} y={12} width={176} height={108} rx={7} fill="#2F6F5E" stroke={INK} strokeWidth={2.5} />
      <Rect x={20} y={131} width={160} height={7} rx={3} fill="#B8794A" stroke={INK} strokeWidth={2.5} />
      {variant === 'talk' ? (
        <G>
          <SvgText x={100} y={36} fill={palette.white} fontSize={15} fontWeight="800" fontFamily={fonts.extrabold} textAnchor="middle">
            Open to Talk
          </SvgText>
          <Pill x={24} y={46} w={48} color={palette.rani500} label="Music" />
          <Pill x={76} y={46} w={48} color={palette.saffron500} label="Cricket" />
          <Pill x={128} y={46} w={48} color={palette.teal500} label="Startups" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Circle key={i} cx={42 + i * 29} cy={95} r={11} fill={[palette.rani500, palette.saffron500, palette.teal500, palette.violet500, palette.marigold500][i]} stroke={INK} strokeWidth={2.2} />
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <Circle key={`h${i}`} cx={42 + i * 29} cy={92} r={3.4} fill={palette.white} opacity={0.9} />
          ))}
        </G>
      ) : (
        <G>
          <SvgText x={100} y={33} fill={palette.white} fontSize={14} fontWeight="800" fontFamily={fonts.extrabold} textAnchor="middle">
            Activity
          </SvgText>
          <Rect x={26} y={42} width={148} height={68} rx={10} fill={palette.white} stroke={INK} strokeWidth={2.2} />
          <SvgText x={100} y={65} fill={INK} fontSize={13} fontWeight="800" fontFamily={fonts.extrabold} textAnchor="middle">
            Badminton at 7?
          </SvgText>
          <Pill x={34} y={79} w={64} color={palette.leaf500} label="I'm in" />
          <Pill x={102} y={79} w={64} color={palette.rani500} label="I'm not in" />
        </G>
      )}
    </Svg>
  );
}

function Pill({ x, y, w, color, label }: { x: number; y: number; w: number; color: string; label: string }) {
  return (
    <G>
      <Rect x={x} y={y} width={w} height={20} rx={10} fill={color} stroke={INK} strokeWidth={2} />
      <SvgText x={x + w / 2} y={y + 14} fill={palette.white} fontSize={9.5} fontWeight="700" fontFamily={fonts.bold} textAnchor="middle">
        {label}
      </SvgText>
    </G>
  );
}

/* -------------------------------- backgrounds -------------------------------- */

export type BackgroundKind = 'home' | 'school' | 'park' | 'sunset';

const BG_PROPS = { width: '100%', height: '100%', viewBox: '0 0 360 640', preserveAspectRatio: 'xMidYMax slice' } as const;

export function Background({ kind }: { kind: BackgroundKind }) {
  if (kind === 'home') return <HomeBackground />;
  if (kind === 'school') return <SchoolBackground />;
  if (kind === 'park') return <ParkBackground />;
  return <SunsetBackground />;
}

function HomeBackground() {
  return (
    <Svg {...BG_PROPS}>
      <Defs>
        <LinearGradient id="bgHome" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={palette.saffron100} />
          <Stop offset="1" stopColor={palette.cream} />
        </LinearGradient>
      </Defs>
      <Rect width={360} height={640} fill="url(#bgHome)" />
      {/* window */}
      <Rect x={34} y={190} width={118} height={170} rx={14} fill={palette.peacock100} stroke={INK} strokeWidth={W} />
      <Circle cx={112} cy={236} r={20} fill={palette.marigold500} stroke={INK} strokeWidth={W} />
      <Path d="M46 330 Q70 300 100 320 Q130 300 142 330 L142 348 L46 348 Z" fill={palette.leaf500} opacity={0.55} />
      <Path d="M93 192 L93 358 M36 275 L150 275" stroke={INK} strokeWidth={W} />
      <Path d="M18 180 Q60 200 52 380 L18 380 Z" fill={palette.rani500} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <Path d="M168 180 Q126 200 134 380 L168 380 Z" fill={palette.rani500} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      {/* frame + shelf */}
      <Rect x={216} y={196} width={46} height={58} rx={6} fill={palette.teal100} stroke={INK} strokeWidth={W} />
      <Circle cx={239} cy={222} r={11} fill={palette.violet500} />
      <Rect x={272} y={206} width={44} height={38} rx={6} fill={palette.marigold100} stroke={INK} strokeWidth={W} />
      <Path d="M280 236 L292 218 L300 228 L306 222 L310 236 Z" fill={palette.leaf500} />
      <Rect x={206} y={340} width={130} height={12} rx={4} fill="#B8794A" stroke={INK} strokeWidth={W} />
      <Path d="M222 340 L222 322 Q214 306 224 296 Q236 308 232 322 L232 340 Z" fill={palette.leaf500} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <Path d="M246 340 L252 304 L262 340 Z" fill={palette.violet500} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <Rect x={290} y={316} width={30} height={24} rx={5} fill={palette.saffron500} stroke={INK} strokeWidth={2.5} />
      {/* floor + rug */}
      <Rect x={0} y={536} width={360} height={104} fill="#EBCB9F" />
      <Rect x={0} y={528} width={360} height={12} fill={palette.sand200} stroke={INK} strokeWidth={W} />
      <Path d="M0 580 L360 580 M0 612 L360 612" stroke="#D9B684" strokeWidth={2} />
      <Ellipse cx={180} cy={592} rx={170} ry={30} fill={palette.violet100} stroke={INK} strokeWidth={W} />
      <Ellipse cx={180} cy={592} rx={140} ry={22} fill="none" stroke={palette.rani500} strokeWidth={3} strokeDasharray="2 10" strokeLinecap="round" />
    </Svg>
  );
}

function SchoolBackground() {
  return (
    <Svg {...BG_PROPS}>
      <Defs>
        <LinearGradient id="bgSchool" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={palette.teal100} />
          <Stop offset="1" stopColor={palette.cream} />
        </LinearGradient>
      </Defs>
      <Rect width={360} height={640} fill="url(#bgSchool)" />
      {/* bunting */}
      <Path d="M0 120 Q90 160 180 120 Q270 160 360 120" stroke={INK} strokeWidth={2.5} fill="none" />
      {Array.from({ length: 10 }, (_, i) => {
        const x = 18 + i * 36;
        const y = 120 + (i % 2 === 0 ? 20 : 22) * Math.sin((x / 180) * Math.PI) * 0.9;
        return (
          <Path
            key={i}
            d={`M${x - 11} ${y} L${x + 11} ${y} L${x} ${y + 26} Z`}
            fill={[palette.rani500, palette.saffron500, palette.teal500, palette.violet500, palette.marigold500][i % 5]}
            stroke={INK}
            strokeWidth={2.2}
            strokeLinejoin="round"
          />
        );
      })}
      {/* clock */}
      <Circle cx={306} cy={236} r={26} fill={palette.white} stroke={INK} strokeWidth={W} />
      <Path d="M306 236 L306 220 M306 236 L318 242" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      {/* cork notice board */}
      <Rect x={22} y={210} width={92} height={78} rx={8} fill="#D9A56B" stroke={INK} strokeWidth={W} />
      <Rect x={32} y={222} width={26} height={26} fill={palette.marigold100} stroke={INK} strokeWidth={2} rotation={-6} origin="45, 235" />
      <Rect x={66} y={228} width={32} height={22} fill={palette.rani100} stroke={INK} strokeWidth={2} rotation={5} origin="82, 239" />
      <Rect x={40} y={256} width={30} height={22} fill={palette.teal100} stroke={INK} strokeWidth={2} />
      <Circle cx={45} cy={224} r={3} fill={palette.rani500} />
      <Circle cx={82} cy={230} r={3} fill={palette.teal600} />
      {/* wall band + floor */}
      <Rect x={0} y={440} width={360} height={100} fill={palette.peacock100} />
      <Path d="M0 440 L360 440" stroke={INK} strokeWidth={W} />
      <Rect x={0} y={536} width={360} height={104} fill="#E3C294" />
      <Rect x={0} y={528} width={360} height={12} fill={palette.sand200} stroke={INK} strokeWidth={W} />
      <Path d="M0 584 L360 584 M0 616 L360 616 M120 540 L90 640 M240 540 L270 640" stroke="#CFAE7E" strokeWidth={2} />
    </Svg>
  );
}

function ParkBackground() {
  return (
    <Svg {...BG_PROPS}>
      <Defs>
        <LinearGradient id="bgPark" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={palette.peacock100} />
          <Stop offset="1" stopColor={palette.saffron100} />
        </LinearGradient>
      </Defs>
      <Rect width={360} height={640} fill="url(#bgPark)" />
      <Circle cx={292} cy={170} r={34} fill={palette.marigold500} stroke={INK} strokeWidth={W} />
      <Path d="M30 230 Q30 214 48 214 Q54 200 72 206 Q90 200 96 216 Q112 216 110 230 Z" fill={palette.white} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <Path d="M200 120 Q200 106 216 106 Q224 94 240 100 Q256 98 258 114 Q270 114 268 126 L200 126 Z" fill={palette.white} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <Path d="M0 440 Q70 380 150 430 Q230 370 360 430 L360 560 L0 560 Z" fill="#9BE0B6" stroke={INK} strokeWidth={W} />
      {/* trees */}
      <Rect x={44} y={398} width={12} height={60} fill="#9A6A44" stroke={INK} strokeWidth={W} />
      <Circle cx={50} cy={378} r={38} fill={palette.leaf500} stroke={INK} strokeWidth={W} />
      <Circle cx={36} cy={388} r={4} fill={palette.rani500} />
      <Circle cx={64} cy={370} r={4} fill={palette.marigold500} />
      <Rect x={298} y={410} width={12} height={52} fill="#9A6A44" stroke={INK} strokeWidth={W} />
      <Circle cx={304} cy={392} r={32} fill={palette.leaf500} stroke={INK} strokeWidth={W} />
      <Circle cx={314} cy={398} r={4} fill={palette.saffron500} />
      {/* grass */}
      <Rect x={0} y={520} width={360} height={120} fill="#6FD28F" />
      <Path d="M0 520 L360 520" stroke={INK} strokeWidth={W} />
      {[24, 80, 140, 214, 262, 330].map((x, i) => (
        <G key={x}>
          <Circle cx={x} cy={560 + (i % 3) * 30} r={4} fill={[palette.rani500, palette.marigold500, palette.white][i % 3]} stroke={INK} strokeWidth={1.8} />
        </G>
      ))}
    </Svg>
  );
}

function SunsetBackground() {
  return (
    <Svg {...BG_PROPS}>
      <Defs>
        <LinearGradient id="bgSunset" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={palette.violet700} />
          <Stop offset="0.55" stopColor={palette.rani500} />
          <Stop offset="1" stopColor={palette.saffron500} />
        </LinearGradient>
      </Defs>
      <Rect width={360} height={640} fill="url(#bgSunset)" />
      <Circle cx={180} cy={470} r={96} fill={palette.marigold500} stroke={INK} strokeWidth={W} />
      <Path d="M0 500 Q60 440 130 490 Q200 430 270 486 Q320 450 360 480 L360 560 L0 560 Z" fill={palette.violet900} opacity={0.85} />
      <Rect x={0} y={528} width={360} height={112} fill={palette.violet700} />
      <Path d="M0 528 L360 528" stroke={INK} strokeWidth={W} />
      <Path d="M0 584 L360 584" stroke={palette.violet500} strokeWidth={2} />
      {/* string lights */}
      <Path d="M0 130 Q90 190 180 130 Q270 190 360 130" stroke={INK} strokeWidth={2.5} fill="none" />
      {Array.from({ length: 12 }, (_, i) => {
        const x = 14 + i * 30.5;
        const y = 130 + 34 * Math.sin((x / 180) * Math.PI) * (x % 180 === 0 ? 0 : 1) * 0.9 + 6;
        return <Circle key={i} cx={x} cy={y} r={7} fill={[palette.marigold500, palette.teal300, palette.rani100, palette.white][i % 4]} stroke={INK} strokeWidth={2} />;
      })}
      {[[40, 60], [300, 70], [150, 40], [250, 36]].map(([x, y]) => (
        <Circle key={`${x}${y}`} cx={x} cy={y} r={2.5} fill={palette.white} opacity={0.9} />
      ))}
    </Svg>
  );
}
