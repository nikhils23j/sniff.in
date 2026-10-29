import type { BackgroundKind } from './props';
import type { CastId, Mood, Pose } from './characters';

export type CastSlot = {
  id: CastId;
  /** Horizontal centre as a fraction of the scene width. */
  x: number;
  /** Relative to the base character height (default 1). */
  scale?: number;
  mood?: Mood;
  leftPose?: Pose;
  rightPose?: Pose;
  /** Where the character walks in from / leaves to. */
  enter?: 'left' | 'right' | 'pop';
  exit?: 'left' | 'right';
  /** Guide only: wears a school uniform. */
  uniform?: boolean;
  /** Teacher only: carries the stack of books. */
  books?: boolean;
};

export type StickerKind =
  | 'diya' | 'rangoli' | 'kite' | 'garland' | 'chai' | 'qr' | 'available' | 'shield' | 'sparkle' | 'books' | 'boardTalk' | 'boardPlan';

export type Sticker = {
  kind: StickerKind;
  /** Horizontal centre (fraction of scene width). */
  x: number;
  /** Bottom edge above the ground, in base character heights. */
  lift: number;
  /** Width in base character heights. */
  size: number;
  /** Drawn behind the characters (default: in front). */
  behind?: boolean;
  /** Squashed to look like it lies on the ground. */
  flat?: boolean;
  delay?: number;
  color?: string;
};

export type Scene = {
  id: string;
  background: BackgroundKind;
  cast: CastSlot[];
  stickers: Sticker[];
  speaker: CastId;
  line: string;
};

export const SPEAKER_NAMES: Record<Exclude<CastId, 'guide'>, string> = {
  brother: 'Arjun',
  mother: 'Mummy',
  teacher: 'Ms. Iyer',
  friend1: 'Meera',
  friend2: 'Kabir',
};

export function speakerName(id: CastId, firstName: string | null): string {
  return id === 'guide' ? firstName ?? 'Your guide' : SPEAKER_NAMES[id];
}

/** The story. `firstName` personalises the guide; with no name the greeting stays neutral. */
export function buildScenes(firstName: string | null): Scene[] {
  const intro = firstName ? `Hey, I'm ${firstName}! I'll walk you through Sniff.in.` : `Hey there! I'll walk you through Sniff.in.`;
  return [
    {
      id: 'hello', background: 'home', speaker: 'guide', line: intro,
      cast: [{ id: 'guide', x: 0.5, mood: 'excited', rightPose: 'wave', enter: 'pop' }],
      stickers: [
        { kind: 'garland', x: 0.5, lift: 0, size: 1.7, behind: true },
        { kind: 'diya', x: 0.14, lift: 0, size: 0.26, delay: 450 },
        { kind: 'diya', x: 0.86, lift: 0, size: 0.26, delay: 600 },
      ],
    },
    {
      id: 'servers', background: 'home', speaker: 'brother',
      line: "On Sniff.in you join Servers — your college, office, building, or tonight's event. Scan a QR or enter a code.",
      cast: [
        { id: 'guide', x: 0.27, mood: 'happy' },
        { id: 'brother', x: 0.72, mood: 'excited', rightPose: 'out', enter: 'right', exit: 'right' },
      ],
      stickers: [
        { kind: 'garland', x: 0.5, lift: 0, size: 1.7, behind: true },
        { kind: 'qr', x: 0.9, lift: 0.5, size: 0.32, delay: 600 },
      ],
    },
    {
      id: 'available', background: 'home', speaker: 'mother',
      line: "When you're Available, people in your Servers can find you. Switch it off anytime — you're in control.",
      cast: [
        { id: 'guide', x: 0.18, scale: 0.88, mood: 'calm' },
        { id: 'brother', x: 0.48, scale: 0.88, mood: 'happy', exit: 'left' },
        { id: 'mother', x: 0.8, scale: 0.92, mood: 'happy', leftPose: 'out', enter: 'right', exit: 'right' },
      ],
      stickers: [
        { kind: 'garland', x: 0.5, lift: 0, size: 1.7, behind: true },
        { kind: 'available', x: 0.5, lift: 0.9, size: 0.56, delay: 500 },
      ],
    },
    {
      id: 'talk', background: 'school', speaker: 'teacher',
      line: "Turn on Open to Talk and say what you'd like to chat about. We'll show you five people who share your interests.",
      cast: [
        { id: 'guide', x: 0.17, scale: 0.82, uniform: true, mood: 'happy', enter: 'left' },
        { id: 'teacher', x: 0.76, mood: 'happy', books: true, enter: 'right', exit: 'right' },
      ],
      stickers: [
        { kind: 'boardTalk', x: 0.4, lift: 0.4, size: 0.92, behind: true, delay: 250 },
        { kind: 'chai', x: 0.42, lift: 0, size: 0.2, delay: 700 },
      ],
    },
    {
      id: 'plans', background: 'school', speaker: 'teacher',
      line: "Post plans in Activity — “Badminton at 7?” — and people tap I'm in or I'm not in.",
      cast: [
        { id: 'guide', x: 0.17, scale: 0.82, uniform: true, mood: 'excited', exit: 'left' },
        { id: 'teacher', x: 0.76, mood: 'excited', books: false, leftPose: 'out', rightPose: 'down', exit: 'right' },
      ],
      stickers: [
        { kind: 'boardPlan', x: 0.4, lift: 0.4, size: 0.92, behind: true, delay: 150 },
        { kind: 'books', x: 0.42, lift: 0, size: 0.34, delay: 600 },
      ],
    },
    {
      id: 'connect', background: 'park', speaker: 'friend1',
      line: 'Connect only when you both accept. Then chat with photos, stickers and conversation starters.',
      cast: [
        { id: 'guide', x: 0.19, scale: 0.9, mood: 'excited', rightPose: 'wave', enter: 'left' },
        { id: 'friend1', x: 0.5, scale: 0.9, mood: 'happy', leftPose: 'wave', enter: 'pop' },
        { id: 'friend2', x: 0.81, scale: 0.9, mood: 'wink', rightPose: 'up', enter: 'right' },
      ],
      stickers: [
        { kind: 'rangoli', x: 0.5, lift: -0.08, size: 1.45, behind: true, flat: true },
        { kind: 'kite', x: 0.1, lift: 1.12, size: 0.24, behind: true, delay: 300 },
        { kind: 'kite', x: 0.92, lift: 1.3, size: 0.2, behind: true, delay: 500, color: '#13C4B8' },
        { kind: 'diya', x: 0.34, lift: 0, size: 0.17, delay: 700 },
        { kind: 'diya', x: 0.66, lift: 0, size: 0.17, delay: 800 },
      ],
    },
    {
      id: 'safe', background: 'sunset', speaker: 'guide',
      line: 'Safe by default: block or report anytime. Ready?',
      cast: [
        { id: 'guide', x: 0.5, mood: 'excited', leftPose: 'up', rightPose: 'up' },
        { id: 'friend1', x: 0.16, scale: 0.85, mood: 'happy', rightPose: 'up' },
        { id: 'friend2', x: 0.84, scale: 0.85, mood: 'happy', leftPose: 'up' },
      ],
      stickers: [
        { kind: 'shield', x: 0.5, lift: 1.12, size: 0.2, delay: 300 },
        { kind: 'sparkle', x: 0.12, lift: 1.1, size: 0.14, delay: 450 },
        { kind: 'sparkle', x: 0.88, lift: 1.15, size: 0.12, delay: 550 },
        { kind: 'sparkle', x: 0.3, lift: 1.25, size: 0.1, delay: 650 },
        { kind: 'diya', x: 0.33, lift: 0, size: 0.17, delay: 700 },
        { kind: 'diya', x: 0.67, lift: 0, size: 0.17, delay: 800 },
      ],
    },
  ];
}
