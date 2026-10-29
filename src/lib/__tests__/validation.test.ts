import {
  ageOn, dobSchema, emailSchema, extractJoinToken, passwordSchema, postSchema, profileSchema, serverSchema, usernameSchema,
} from '../validation';

describe('age gate', () => {
  const today = new Date('2026-10-18T12:00:00');
  it('computes whole years, respecting birthdays not yet reached', () => {
    expect(ageOn(new Date('2008-10-18T00:00:00'), today)).toBe(18);
    expect(ageOn(new Date('2008-10-19T00:00:00'), today)).toBe(17);
    expect(ageOn(new Date('2000-01-01T00:00:00'), today)).toBe(26);
  });
  it('rejects under-18 and malformed dates', () => {
    const y = new Date().getFullYear();
    expect(dobSchema.safeParse(`${y - 17}-01-01`).success).toBe(false);
    expect(dobSchema.safeParse(`${y - 30}-01-01`).success).toBe(true);
    expect(dobSchema.safeParse('01/01/1990').success).toBe(false);
    expect(dobSchema.safeParse('1800-01-01').success).toBe(false);
  });
});

describe('credentials', () => {
  it('normalises email', () => {
    expect(emailSchema.parse('  Me@Example.COM ')).toBe('me@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
  it('requires 8+ chars with letters and digits', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('onlyletters').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
    expect(passwordSchema.safeParse('letters123').success).toBe(true);
  });
  it('matches the DB username rule', () => {
    expect(usernameSchema.parse('Nikhil_J')).toBe('nikhil_j');
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('has space').success).toBe(false);
    expect(usernameSchema.safeParse('a'.repeat(21)).success).toBe(false);
  });
});

describe('profile fields mirror DB CHECK constraints', () => {
  const base = { display_name: 'Aarav' };
  it('accepts empty optional fields', () => {
    expect(profileSchema.safeParse({ ...base, website_url: '', linkedin_url: '' }).success).toBe(true);
  });
  it('requires https links and real hosts for socials', () => {
    expect(profileSchema.safeParse({ ...base, website_url: 'http://x.com' }).success).toBe(false);
    expect(profileSchema.safeParse({ ...base, linkedin_url: 'https://evil.com/in/x' }).success).toBe(false);
    expect(profileSchema.safeParse({ ...base, linkedin_url: 'https://www.linkedin.com/in/aarav' }).success).toBe(true);
  });
  it('strips @ from instagram handles', () => {
    const r = profileSchema.parse({ ...base, instagram_handle: '@sniff.in' });
    expect(r.instagram_handle).toBe('sniff.in');
    expect(profileSchema.safeParse({ ...base, instagram_handle: 'bad handle!' }).success).toBe(false);
  });
});

describe('server rules', () => {
  const valid = {
    name: 'Hall 4', description: '', kind: 'long_term' as const, category: 'hall', joinPolicy: 'invite_only' as const,
    visibility: 'unlisted' as const, endsAt: null, ephemeralChats: false, city: '',
  };
  it('accepts a long-term server', () => expect(serverSchema.safeParse(valid).success).toBe(true));
  it('short-term requires a future end and allows scheduled events within 60 days', () => {
    expect(serverSchema.safeParse({ ...valid, kind: 'short_term' }).success).toBe(false);
    expect(serverSchema.safeParse({ ...valid, kind: 'short_term', endsAt: new Date(Date.now() - 1000) }).success).toBe(false);
    expect(serverSchema.safeParse({ ...valid, kind: 'short_term', endsAt: new Date(Date.now() + 40 * 86400_000) }).success).toBe(true);
    expect(serverSchema.safeParse({ ...valid, kind: 'short_term', endsAt: new Date(Date.now() + 61 * 86400_000) }).success).toBe(false);
    expect(serverSchema.safeParse({ ...valid, kind: 'short_term', endsAt: new Date(Date.now() + 3600_000), ephemeralChats: true }).success).toBe(true);
  });
  it('ephemeral chats and open joining are restricted', () => {
    expect(serverSchema.safeParse({ ...valid, ephemeralChats: true }).success).toBe(false);
    expect(serverSchema.safeParse({ ...valid, joinPolicy: 'open' }).success).toBe(false);
  });
});

describe('activity posts', () => {
  it('validates body length and server', () => {
    const ok = { body: 'Kedarnath trip, need 2 more', category: 'travel', serverId: '7f1c2a7e-1b2c-4d5e-8f90-123456789abc', expiresHours: 48 };
    expect(postSchema.safeParse(ok).success).toBe(true);
    expect(postSchema.safeParse({ ...ok, body: 'hi' }).success).toBe(false);
    expect(postSchema.safeParse({ ...ok, serverId: 'nope' }).success).toBe(false);
  });
});

describe('join token extraction (mirrors app_private.normalize_token)', () => {
  const tok = 'Ab3_-xYz0123456789AbCdEf';
  it('reads tokens from URLs, deep links and raw input', () => {
    expect(extractJoinToken(`https://sniff.in/join?t=${tok}`)).toBe(tok);
    expect(extractJoinToken(`sniffin://join?t=${tok}&utm=x`)).toBe(tok);
    expect(extractJoinToken(`https://sniff.in/join/${tok}`)).toBe(tok);
    expect(extractJoinToken(tok)).toBe(tok);
  });
  it('upper-cases 8-char codes and rejects junk', () => {
    expect(extractJoinToken(' abcd2345 ')).toBe('ABCD2345');
    expect(extractJoinToken('hello world')).toBeNull();
    expect(extractJoinToken('')).toBeNull();
  });
});
