import { AppError } from '@/lib/errors';

/** A successful Supabase implicit-flow callback returns both tokens in the URL fragment. */
export function sessionFromOAuthUrl(url: string): { access_token: string; refresh_token: string } {
  const fragment = url.split('#')[1] ?? '';
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  const params = new URLSearchParams(fragment || query);
  const errorDescription = params.get('error_description') ?? params.get('error');
  if (errorDescription) throw new AppError('oauth_failed', errorDescription);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) {
    throw new AppError('oauth_callback_invalid', 'Sign-in did not return a session. Please try again.');
  }
  return { access_token, refresh_token };
}
