import { firstNameOf } from '../name';

describe('firstNameOf', () => {
  it('takes the first word', () => {
    expect(firstNameOf('  Priya  Sharma ')).toBe('Priya');
  });
  it('keeps non-latin names', () => {
    expect(firstNameOf('प्रिया शर्मा')).toBe('प्रिया');
  });
  it('returns null for empty or missing names', () => {
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf('   ')).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
    expect(firstNameOf('🙂')).toBeNull();
  });
});
