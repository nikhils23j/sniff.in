import { templateIcebreakers, type IcebreakerContext } from '../../../supabase/functions/_shared/icebreaker-templates';
import { liveCricketOpener } from '../../../supabase/functions/_shared/current-cricket';
import { parseCurrentTopicResponse } from '../../../supabase/functions/_shared/current-topic-parser';

const base: IcebreakerContext = {
  other_name: 'Bhavna', shared_tags: [], same_university: null, their_craving: null, their_occupation: null, server_name: null,
};

describe('template icebreakers (deterministic fallback)', () => {
  it('always returns at least one suggestion, at most 3', () => {
    expect(templateIcebreakers(base).length).toBe(1);
    const many = templateIcebreakers({
      ...base,
      shared_tags: [{ kind: 'interest', name: 'ML' }, { kind: 'hobby', name: 'Badminton' }, { kind: 'skill', name: 'Python' }, { kind: 'language', name: 'Hindi' }],
      same_university: 'IIT Kanpur', server_name: 'Hall 4',
    });
    expect(many.length).toBe(3);
  });

  it('only uses provided facts', () => {
    const out = templateIcebreakers({ ...base, shared_tags: [{ kind: 'hobby', name: 'Badminton' }] }).join(' ');
    expect(out).toMatch(/badminton/i);
    expect(out).not.toMatch(/IIT|Spotify|concert/);
  });

  it('prioritises the current craving and interests over languages', () => {
    const out = templateIcebreakers({
      ...base,
      their_craving: 'Looking for a badminton partner',
      shared_tags: [{ kind: 'language', name: 'Hindi' }, { kind: 'interest', name: 'Startups' }],
    });
    expect(out[0]).toContain('badminton partner');
    expect(out[1]).toContain('Startups');
  });

  it('is stable for the same pair', () => {
    const ctx = { ...base, shared_tags: [{ kind: 'interest' as const, name: 'Music' }], server_name: 'NH7' };
    expect(templateIcebreakers(ctx)).toEqual(templateIcebreakers(ctx));
  });

  it('produces sendable questions for shared cricket and chess, never instructions', () => {
    const out = templateIcebreakers({ ...base, shared_tags: [
      { kind: 'interest', name: 'Cricket' }, { kind: 'hobby', name: 'Chess' },
    ] });
    expect(out.join(' ')).toMatch(/cricket/i);
    expect(out.join(' ')).toMatch(/chess/i);
    expect(out.every((s) => s.includes('?'))).toBe(true);
    expect(out.join(' ')).not.toMatch(/ask (them|what)|tell them|say hi|you're both/i);
  });
});

describe('verified live cricket suggestion', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const match = { teams: ['India', 'Australia'], dateTimeGMT: '2026-10-25T10:00:00Z', matchStarted: true, matchEnded: false };

  it('mentions teams only while the feed confirms a current match', () => {
    expect(liveCricketOpener([match], now)).toContain('India vs Australia');
    expect(liveCricketOpener([{ ...match, matchEnded: true }], now)).toBeNull();
    expect(liveCricketOpener([{ ...match, matchStarted: false }], now)).toBeNull();
    expect(liveCricketOpener([{ ...match, dateTimeGMT: '2026-10-01T10:00:00Z' }], now)).toBeNull();
  });

  it('never invents a score or century', () => {
    expect(liveCricketOpener([match], now)).not.toMatch(/\d+\/\d+|century|runs/i);
  });
});

describe('sourced current-topic suggestions', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const event = { suggestion: 'Did you see the India–Australia match today? What stood out to you?',
    source_url: 'https://example.org/match', source_title: 'Match report', event_date: '2026-10-25T10:00:00Z' };
  const answer = (value: typeof event, includeSource = true) => ({ status: 'completed', output: [
    { type: 'web_search_call', action: { sources: includeSource ? [{ url: event.source_url, title: 'Match report' }] : [] } },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
  ] });

  it('accepts only fresh questions backed by a retrieved URL', () => {
    expect(parseCurrentTopicResponse(answer(event), now)?.suggestion).toBe(event.suggestion);
    expect(parseCurrentTopicResponse(answer(event, false), now)).toBeNull();
    expect(parseCurrentTopicResponse(answer({ ...event, event_date: '2026-10-01' }), now)).toBeNull();
    expect(parseCurrentTopicResponse(answer({ ...event, suggestion: 'Ask them about cricket.' }), now)).toBeNull();
  });
});
