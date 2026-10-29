import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

/**
 * Built-in Indian-themed stickers, drawn as vector art (no network, no licensing). Each is a 100x100 canvas
 * on a white "die-cut" disc. Ids are what is stored in messages.sticker_id (^[a-z0-9_-]{1,40}$), so never rename one.
 * These are illustration colours, intentionally not theme tokens.
 */
type Art = () => React.JSX.Element;

const petals = (n: number, cx: number, cy: number, rx: number, ry: number, dist: number, colors: string[]) =>
  Array.from({ length: n }, (_, i) => (
    <Ellipse
      key={i}
      cx={cx}
      cy={cy - dist}
      rx={rx}
      ry={ry}
      fill={colors[i % colors.length]}
      rotation={(360 / n) * i}
      origin={`${cx}, ${cy}`}
    />
  ));

const Namaste: Art = () => (
  <>
    <Circle cx="50" cy="50" r="40" fill="#FFF3CC" />
    <Path d="M50 18 C37 26 29 44 33 62 L50 74 Z" fill="#F3B27A" stroke="#C9803F" strokeWidth="2" strokeLinejoin="round" />
    <Path d="M50 18 C63 26 71 44 67 62 L50 74 Z" fill="#F9C896" stroke="#C9803F" strokeWidth="2" strokeLinejoin="round" />
    <Path d="M50 24 L50 72" stroke="#C9803F" strokeWidth="1.5" strokeLinecap="round" />
    <Path d="M31 62 L50 76 L69 62 L69 76 L50 88 L31 76 Z" fill="#FF8A00" stroke="#C25F00" strokeWidth="2" strokeLinejoin="round" />
    <Line x1="50" y1="6" x2="50" y2="12" stroke="#FFB800" strokeWidth="3" strokeLinecap="round" />
    <Line x1="30" y1="12" x2="34" y2="17" stroke="#E91E63" strokeWidth="3" strokeLinecap="round" />
    <Line x1="70" y1="12" x2="66" y2="17" stroke="#13C4B8" strokeWidth="3" strokeLinecap="round" />
  </>
);

const Chai: Art = () => (
  <>
    <Circle cx="50" cy="50" r="42" fill="#FDE2EC" />
    <Path d="M38 22 C34 28 42 30 38 37" stroke="#9A8FB0" strokeWidth="3" strokeLinecap="round" fill="none" />
    <Path d="M52 20 C48 26 56 28 52 36" stroke="#9A8FB0" strokeWidth="3" strokeLinecap="round" fill="none" />
    <Path d="M66 22 C62 28 70 30 66 37" stroke="#9A8FB0" strokeWidth="3" strokeLinecap="round" fill="none" />
    <Path d="M74 46 C90 44 90 66 72 66" stroke="#6C3CE9" strokeWidth="5" strokeLinecap="round" fill="none" />
    <Path d="M24 42 H74 V56 C74 70 64 78 49 78 C34 78 24 70 24 56 Z" fill="#8A63F2" stroke="#4B2BC9" strokeWidth="2.5" strokeLinejoin="round" />
    <Ellipse cx="49" cy="42" rx="25" ry="6" fill="#B5651D" stroke="#4B2BC9" strokeWidth="2.5" />
    <Path d="M30 54 H68" stroke="#FFB800" strokeWidth="3" strokeLinecap="round" />
    <Circle cx="38" cy="64" r="2.5" fill="#FFB800" />
    <Circle cx="49" cy="66" r="2.5" fill="#FF8A00" />
    <Circle cx="60" cy="64" r="2.5" fill="#FFB800" />
    <Ellipse cx="49" cy="82" rx="30" ry="5" fill="#FFB800" stroke="#C27A12" strokeWidth="2" />
  </>
);

const Diya: Art = () => (
  <>
    <Circle cx="50" cy="50" r="42" fill="#2A1A6E" />
    <Circle cx="50" cy="40" r="26" fill="#FFB800" opacity="0.25" />
    <Circle cx="50" cy="40" r="17" fill="#FFB800" opacity="0.25" />
    <Path d="M50 14 C60 28 64 40 50 54 C36 40 40 28 50 14 Z" fill="#FFB800" stroke="#FF8A00" strokeWidth="2" strokeLinejoin="round" />
    <Path d="M50 30 C55 38 56 44 50 50 C44 44 45 38 50 30 Z" fill="#FF5A1F" />
    <Path d="M20 56 C20 76 34 84 50 84 C66 84 80 76 80 56 Z" fill="#E0762B" stroke="#8C3F0E" strokeWidth="2.5" strokeLinejoin="round" />
    <Ellipse cx="50" cy="56" rx="30" ry="6" fill="#F59A4C" stroke="#8C3F0E" strokeWidth="2.5" />
    <Circle cx="38" cy="70" r="3" fill="#FFB800" />
    <Circle cx="50" cy="74" r="3" fill="#FFB800" />
    <Circle cx="62" cy="70" r="3" fill="#FFB800" />
  </>
);

const Rangoli: Art = () => (
  <>
    <Circle cx="50" cy="50" r="42" fill="#FFF6EC" />
    {petals(8, 50, 50, 8, 16, 26, ['#E91E63', '#FF8A00'])}
    {petals(8, 50, 50, 6, 12, 14, ['#13C4B8', '#6C3CE9'])}
    {Array.from({ length: 16 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 16;
      return <Circle key={i} cx={50 + Math.cos(a) * 38} cy={50 + Math.sin(a) * 38} r="2.4" fill={i % 2 ? '#FFB800' : '#0E7CC9'} />;
    })}
    <Circle cx="50" cy="50" r="8" fill="#FFB800" stroke="#fff" strokeWidth="2" />
    <Circle cx="50" cy="50" r="3" fill="#E91E63" />
  </>
);

const Auto: Art = () => (
  <>
    <Circle cx="50" cy="50" r="42" fill="#DCEEFB" />
    <Path d="M20 38 C20 30 28 26 36 26 H60 C66 26 69 30 71 36 L77 52 H18 Z" fill="#FFC400" stroke="#8A6A00" strokeWidth="2.5" strokeLinejoin="round" />
    <Rect x="16" y="50" width="66" height="18" rx="5" fill="#1FA364" stroke="#0F5F3A" strokeWidth="2.5" />
    <Rect x="27" y="34" width="20" height="13" rx="2" fill="#CDEBFF" stroke="#8A6A00" strokeWidth="2" />
    <Path d="M60 34 L67 36 L71 47 H60 Z" fill="#CDEBFF" stroke="#8A6A00" strokeWidth="2" strokeLinejoin="round" />
    <Circle cx="78" cy="58" r="3" fill="#FFF3CC" />
    <Circle cx="32" cy="70" r="9" fill="#2B2B2B" />
    <Circle cx="32" cy="70" r="3.5" fill="#CFCFCF" />
    <Circle cx="68" cy="70" r="9" fill="#2B2B2B" />
    <Circle cx="68" cy="70" r="3.5" fill="#CFCFCF" />
  </>
);

const Samosa: Art = () => (
  <>
    <Circle cx="50" cy="50" r="42" fill="#DDF5E7" />
    <Path d="M50 18 L84 76 H16 Z" fill="#E8A33D" stroke="#9C5A10" strokeWidth="3" strokeLinejoin="round" />
    <Path d="M50 30 L72 70 H28 Z" fill="#F2BC5E" />
    <Path d="M20 72 L26 68 L32 72 L38 68 L44 72 L50 68 L56 72 L62 68 L68 72 L74 68 L80 72" stroke="#9C5A10" strokeWidth="2" fill="none" strokeLinejoin="round" />
    <Circle cx="46" cy="50" r="2.2" fill="#B96F16" />
    <Circle cx="56" cy="58" r="2.2" fill="#B96F16" />
    <Circle cx="42" cy="62" r="2.2" fill="#B96F16" />
    <Circle cx="58" cy="44" r="2.2" fill="#B96F16" />
    <Circle cx="80" cy="82" r="6" fill="#2BAE66" stroke="#1B7A46" strokeWidth="2" />
  </>
);

const Cricket: Art = () => (
  <>
    <Circle cx="50" cy="50" r="42" fill="#DDF5E7" />
    <G rotation="35" origin="46, 50">
      <Rect x="42" y="10" width="8" height="22" rx="3" fill="#2A1A6E" />
      <Rect x="36" y="30" width="20" height="52" rx="6" fill="#F2C27B" stroke="#9C5A10" strokeWidth="2.5" />
      <Path d="M46 36 V76" stroke="#C98B3E" strokeWidth="2" strokeLinecap="round" />
    </G>
    <Circle cx="70" cy="72" r="13" fill="#D62828" stroke="#7E1111" strokeWidth="2.5" />
    <Path d="M60 66 C66 72 66 76 62 82" stroke="#fff" strokeWidth="2" fill="none" strokeDasharray="3 2.5" />
    <Path d="M80 66 C74 72 74 76 78 82" stroke="#fff" strokeWidth="2" fill="none" strokeDasharray="3 2.5" />
  </>
);

const Kite: Art = () => (
  <>
    <Circle cx="50" cy="50" r="42" fill="#DCEEFB" />
    <Polygon points="50,10 74,38 50,66 26,38" fill="#E91E63" />
    <Polygon points="50,10 74,38 50,38" fill="#FF8A00" />
    <Polygon points="50,66 26,38 50,38" fill="#13C4B8" />
    <Polygon points="50,10 74,38 50,66 26,38" fill="none" stroke="#2A1A6E" strokeWidth="2.5" strokeLinejoin="round" />
    <Line x1="50" y1="10" x2="50" y2="66" stroke="#2A1A6E" strokeWidth="1.8" />
    <Line x1="26" y1="38" x2="74" y2="38" stroke="#2A1A6E" strokeWidth="1.8" />
    <Path d="M50 66 C42 72 58 76 48 82 C40 87 54 90 46 94" stroke="#6C3CE9" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    <Circle cx="46" cy="76" r="3" fill="#FFB800" />
    <Circle cx="52" cy="86" r="3" fill="#E91E63" />
  </>
);

const Holi: Art = () => (
  <>
    <Circle cx="50" cy="50" r="42" fill="#fff" />
    <Circle cx="38" cy="40" r="22" fill="#E91E63" opacity="0.9" />
    <Circle cx="62" cy="38" r="20" fill="#FFB800" opacity="0.9" />
    <Circle cx="64" cy="62" r="21" fill="#13C4B8" opacity="0.88" />
    <Circle cx="36" cy="64" r="19" fill="#6C3CE9" opacity="0.88" />
    <Circle cx="50" cy="51" r="14" fill="#0E7CC9" opacity="0.85" />
    <Circle cx="14" cy="50" r="4" fill="#FF8A00" />
    <Circle cx="86" cy="48" r="4" fill="#E91E63" />
    <Circle cx="50" cy="10" r="3.5" fill="#6C3CE9" />
    <Circle cx="48" cy="92" r="3.5" fill="#2BAE66" />
    <Circle cx="22" cy="24" r="3" fill="#13C4B8" />
    <Circle cx="80" cy="80" r="3" fill="#FFB800" />
    <Circle cx="44" cy="44" r="4" fill="#fff" opacity="0.55" />
  </>
);

const Marigold: Art = () => (
  <>
    <Circle cx="50" cy="50" r="42" fill="#FFF3CC" />
    {petals(12, 50, 50, 9, 17, 25, ['#FF8A00', '#FFB800'])}
    {petals(12, 50, 50, 6, 11, 14, ['#FFB800', '#F07A00'])}
    <Circle cx="50" cy="50" r="9" fill="#C25F00" />
    <Circle cx="50" cy="50" r="4" fill="#8C3F0E" />
  </>
);

const Party: Art = () => (
  <>
    <Circle cx="50" cy="50" r="42" fill="#F7F3FF" />
    <Path d="M18 84 L30 44 L58 72 Z" fill="#FFB800" stroke="#C25F00" strokeWidth="2.5" strokeLinejoin="round" />
    <Path d="M24 66 L40 60 M20 76 L48 66" stroke="#E91E63" strokeWidth="3" strokeLinecap="round" />
    <Path d="M52 42 C56 28 66 34 68 22" stroke="#E91E63" strokeWidth="3" fill="none" strokeLinecap="round" />
    <Path d="M62 56 C74 52 72 42 84 42" stroke="#13C4B8" strokeWidth="3" fill="none" strokeLinecap="round" />
    <Rect x="64" y="20" width="7" height="7" rx="1.5" fill="#6C3CE9" rotation="25" origin="67, 23" />
    <Rect x="78" y="30" width="7" height="7" rx="1.5" fill="#FF8A00" rotation="-20" origin="81, 33" />
    <Rect x="44" y="20" width="6" height="6" rx="1.5" fill="#0E7CC9" rotation="40" origin="47, 23" />
    <Circle cx="76" cy="58" r="3.5" fill="#E91E63" />
    <Circle cx="36" cy="30" r="3.5" fill="#2BAE66" />
    <Circle cx="84" cy="24" r="3" fill="#FFB800" />
    <Circle cx="56" cy="30" r="2.5" fill="#6C3CE9" />
  </>
);

const Heart: Art = () => (
  <>
    <Defs>
      <LinearGradient id="heartGrad" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#FF5C8D" />
        <Stop offset="1" stopColor="#D81B60" />
      </LinearGradient>
    </Defs>
    <Circle cx="50" cy="50" r="42" fill="#FDE2EC" />
    <Path
      d="M50 84 C16 60 10 40 24 26 C35 16 48 22 50 33 C52 22 65 16 76 26 C90 40 84 60 50 84 Z"
      fill="url(#heartGrad)"
      stroke="#A3124A"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <Ellipse cx="32" cy="36" rx="7" ry="4" fill="#fff" opacity="0.55" rotation="-35" origin="32, 36" />
  </>
);

export const STICKERS: { id: string; label: string; Art: Art }[] = [
  { id: 'namaste', label: 'Namaste', Art: Namaste },
  { id: 'chai', label: 'Chai', Art: Chai },
  { id: 'diya', label: 'Diya', Art: Diya },
  { id: 'rangoli', label: 'Rangoli', Art: Rangoli },
  { id: 'auto', label: 'Auto-rickshaw', Art: Auto },
  { id: 'samosa', label: 'Samosa', Art: Samosa },
  { id: 'cricket', label: 'Cricket', Art: Cricket },
  { id: 'kite', label: 'Kite', Art: Kite },
  { id: 'holi', label: 'Holi colours', Art: Holi },
  { id: 'marigold', label: 'Marigold', Art: Marigold },
  { id: 'party', label: 'Party popper', Art: Party },
  { id: 'heart', label: 'Heart', Art: Heart },
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

export const stickerLabel = (id: string) => BY_ID.get(id)?.label ?? 'Sticker';

/** A die-cut sticker: art on a white outline. Unknown ids (from a newer app version) render a neutral placeholder. */
export function Sticker({ id, size = 120 }: { id: string; size?: number }) {
  const sticker = BY_ID.get(id);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel={`${stickerLabel(id)} sticker`}>
      <Circle cx="50" cy="51" r="49" fill="#000" opacity="0.08" />
      <Circle cx="50" cy="50" r="48.5" fill="#fff" />
      {sticker ? <sticker.Art /> : (
        <>
          <Circle cx="50" cy="50" r="42" fill="#EFE9FF" />
          <Path d="M50 26 L56 44 L74 44 L60 55 L65 73 L50 62 L35 73 L40 55 L26 44 L44 44 Z" fill="#8A63F2" />
        </>
      )}
    </Svg>
  );
}
