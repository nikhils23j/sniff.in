import { minutesUntil, resolveTalkMinutes, type TalkDuration } from '../presets';

const d = (preset: TalkDuration['preset'], custom = '', unit: TalkDuration['unit'] = 'min'): TalkDuration => ({ preset, custom, unit });

describe('resolveTalkMinutes', () => {
  it('uses presets as minutes', () => {
    expect(resolveTalkMinutes(d('30'), null)).toEqual({ minutes: 30, capped: false });
    expect(resolveTalkMinutes(d('240'), null)).toEqual({ minutes: 240, capped: false });
  });

  it('accepts custom minutes and hours within 1 min – 12 h', () => {
    expect(resolveTalkMinutes(d('custom', '45'), null)).toEqual({ minutes: 45, capped: false });
    expect(resolveTalkMinutes(d('custom', '1.5', 'h'), null)).toEqual({ minutes: 90, capped: false });
    expect(resolveTalkMinutes(d('custom', '12', 'h'), null)).toEqual({ minutes: 720, capped: false });
  });

  it('rejects empty, zero and over-12-hour custom values', () => {
    expect('error' in resolveTalkMinutes(d('custom', ''), null)).toBe(true);
    expect('error' in resolveTalkMinutes(d('custom', '0'), null)).toBe(true);
    expect('error' in resolveTalkMinutes(d('custom', '13', 'h'), null)).toBe(true);
    expect('error' in resolveTalkMinutes(d('custom', '721'), null)).toBe(true);
  });

  it('caps by the Server end and fails once it has ended', () => {
    expect(resolveTalkMinutes(d('240'), 50)).toEqual({ minutes: 50, capped: true });
    expect(resolveTalkMinutes(d('30'), 50)).toEqual({ minutes: 30, capped: false });
    expect('error' in resolveTalkMinutes(d('30'), 0)).toBe(true);
  });
});

describe('minutesUntil', () => {
  it('returns null without an end and floors otherwise', () => {
    const now = Date.UTC(2026, 9, 23, 18, 0, 0);
    expect(minutesUntil(null, now)).toBeNull();
    expect(minutesUntil(new Date(now + 90.5 * 60_000).toISOString(), now)).toBe(90);
  });
});
