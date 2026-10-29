import { sessionFromOAuthUrl } from '../oauth';

describe('OAuth return link', () => {
  it('extracts both session tokens from the callback fragment', () => {
    expect(sessionFromOAuthUrl('sniffin://auth/callback#access_token=abc&refresh_token=xyz&token_type=bearer'))
      .toEqual({ access_token: 'abc', refresh_token: 'xyz' });
  });

  it('does not accept a cancelled or incomplete callback as a login', () => {
    expect(() => sessionFromOAuthUrl('sniffin://auth/callback?error=access_denied'))
      .toThrow('access_denied');
    expect(() => sessionFromOAuthUrl('sniffin://auth/callback#access_token=abc'))
      .toThrow('did not return a session');
  });
});
