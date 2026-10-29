import { addDays, addHours, addMinutes, endOfDay, format } from 'date-fns';

import type { BadgeKind, ServerCategory, ServerKind } from '@/types/domain';

/** Shared option lists for creating / editing Servers (UI only; the database stays the authority). */
export const LONG_TERM_CATEGORIES: ServerCategory[] = [
  'university', 'college', 'hall', 'club', 'company', 'office', 'team', 'apartment', 'alumni', 'community', 'other',
];
export const SHORT_TERM_CATEGORIES: ServerCategory[] = ['event', 'concert', 'festival', 'conference', 'party', 'restaurant', 'travel', 'other'];
export const GLOBAL_CATEGORIES: ServerCategory[] = ['city', 'community', 'other'];

export function categoriesFor(kind: ServerKind): ServerCategory[] {
  return kind === 'short_term' ? SHORT_TERM_CATEGORIES : kind === 'global' ? GLOBAL_CATEGORIES : LONG_TERM_CATEGORIES;
}

export const CATEGORY_LABEL: Record<ServerCategory, string> = {
  university: 'University', college: 'College', hall: 'Hall / hostel', club: 'Club', company: 'Company', office: 'Office',
  team: 'Team', apartment: 'Apartment', alumni: 'Alumni', community: 'Community', event: 'Event', concert: 'Concert',
  festival: 'Festival', conference: 'Conference', party: 'Party', restaurant: 'Restaurant / bar', travel: 'Travel',
  city: 'City', other: 'Other',
};

export type EndPreset = { key: string; label: string; at: () => Date };

/** Quick end-time choices for short-term Servers (no native date picker dependency). */
export const END_PRESETS: EndPreset[] = [
  { key: '2h', label: '2 hours', at: () => addHours(new Date(), 2) },
  { key: '4h', label: '4 hours', at: () => addHours(new Date(), 4) },
  {
    key: 'tonight',
    label: 'Tonight 11:59 pm',
    at: () => {
      const t = endOfDay(new Date());
      t.setSeconds(0, 0);
      // If it's nearly midnight already, roll to tomorrow night so the Server isn't instantly over.
      return t.getTime() - Date.now() < 30 * 60_000 ? addDays(t, 1) : t;
    },
  },
  { key: '24h', label: '24 hours', at: () => addHours(new Date(), 24) },
  { key: '3d', label: '3 days', at: () => addDays(new Date(), 3) },
];

/** The quick choices shown when creating a temporary Server (plus a custom duration). */
export const CREATE_END_PRESET_KEYS = ['2h', '4h', 'tonight'] as const;

/** "End now" for settings: server needs a future timestamp, so use now + 1 minute. */
export const endNowDate = () => addMinutes(new Date(), 1);

export const formatDateTime = (iso: string | Date) => format(typeof iso === 'string' ? new Date(iso) : iso, 'EEE d MMM, h:mm a');

export const BADGE_KINDS: { kind: BadgeKind; label: string; defaultLabel: string }[] = [
  { kind: 'student', label: 'Student', defaultLabel: 'Verified Student' },
  { kind: 'alumni', label: 'Alumni', defaultLabel: 'Verified Alumni' },
  { kind: 'employee', label: 'Employee', defaultLabel: 'Verified Employee' },
  { kind: 'resident', label: 'Resident', defaultLabel: 'Verified Resident' },
  { kind: 'member', label: 'Member', defaultLabel: 'Verified Member' },
  { kind: 'attendee', label: 'Attendee', defaultLabel: 'Verified Attendee' },
  { kind: 'organizer', label: 'Organizer', defaultLabel: 'Organizer' },
  { kind: 'custom', label: 'Custom', defaultLabel: '' },
];

// ---------------------------------------------------------------- Open to Talk duration
export type TalkPreset = '30' | '120' | '240' | 'custom';
export type TalkUnit = 'min' | 'h';
export type TalkDuration = { preset: TalkPreset; custom: string; unit: TalkUnit };

export const TALK_PRESETS: { key: Exclude<TalkPreset, 'custom'>; label: string; minutes: number }[] = [
  { key: '30', label: '30 min', minutes: 30 },
  { key: '120', label: '2 hours', minutes: 120 },
  { key: '240', label: '4 hours', minutes: 240 },
];
/** Server-side limit for set_open_to_talk / set_venue_session (1 minute – 12 hours). */
export const TALK_MAX_MINUTES = 720;
export const DEFAULT_TALK_DURATION: TalkDuration = { preset: '120', custom: '1', unit: 'h' };

/** Minutes left before `endsAt` (a temporary Server's end), floored; null when there is no end. */
export function minutesUntil(endsAt: string | null | undefined, now: number): number | null {
  if (!endsAt) return null;
  return Math.floor((new Date(endsAt).getTime() - now) / 60_000);
}

/**
 * Resolves the picker to whole minutes in 1..720, capped by the Server end (the backend caps too).
 * Returns an error message for invalid custom input or a Server that has (almost) ended.
 */
export function resolveTalkMinutes(d: TalkDuration, capMinutes: number | null): { minutes: number; capped: boolean } | { error: string } {
  let minutes: number;
  if (d.preset === 'custom') {
    const n = Number(d.custom.replace(',', '.').trim());
    if (!d.custom.trim() || !Number.isFinite(n) || n <= 0) return { error: 'Enter how long you want to be Open to Talk' };
    minutes = Math.round(d.unit === 'h' ? n * 60 : n);
    if (minutes < 1 || minutes > TALK_MAX_MINUTES) return { error: 'Choose between 1 minute and 12 hours' };
  } else {
    minutes = Number(d.preset);
  }
  if (capMinutes !== null) {
    if (capMinutes < 1) return { error: 'This Server has ended' };
    if (minutes > capMinutes) return { minutes: capMinutes, capped: true };
  }
  return { minutes, capped: false };
}

export const formatClock = (iso: string | Date | number) => format(new Date(iso), 'h:mm a');
