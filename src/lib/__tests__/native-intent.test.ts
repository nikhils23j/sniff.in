import { redirectSystemPath } from '../../app/+native-intent';

const go = (path: string) => redirectSystemPath({ path, initial: true });

describe('profile deep links', () => {
  it('maps shared profile URLs to the in-app route', () => {
    expect(go('https://sniffin-navy.vercel.app/@Nikhil_J')).toBe('/u/nikhil_j');
    expect(go('/@nikhil')).toBe('/u/nikhil');
    expect(go('sniffin://@nikhil')).toBe('/u/nikhil');
    expect(go('https://sniffin-navy.vercel.app/@nikhil?ref=share')).toBe('/u/nikhil');
  });
  it('leaves invites, posts and invalid handles untouched', () => {
    expect(go('https://sniffin-navy.vercel.app/join?t=abc')).toBe('https://sniffin-navy.vercel.app/join?t=abc');
    expect(go('/post/123')).toBe('/post/123');
    expect(go('/@a')).toBe('/@a');
    expect(go('/@../../etc')).toBe('/@../../etc');
  });
});
