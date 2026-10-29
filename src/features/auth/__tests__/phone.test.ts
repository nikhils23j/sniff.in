import { e164Phone } from '../phone';

describe('phone sign-in number', () => {
  it('combines an explicit country code with a formatted local number', () => {
    expect(e164Phone('+91', '98765 43210')).toBe('+919876543210');
    expect(e164Phone('+1', '(415) 555-2671')).toBe('+14155552671');
  });

  it('rejects missing or implausible E.164 numbers before requesting an SMS', () => {
    expect(e164Phone('', '9876543210')).toBeNull();
    expect(e164Phone('+91', '123')).toBeNull();
    expect(e164Phone('+123456', '123456789012345')).toBeNull();
  });
});
