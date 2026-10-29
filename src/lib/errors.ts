/**
 * Normalises Supabase / Postgres / network failures into a stable { code, message } shape.
 * Server RPCs raise "code: human message" (see app_private.fail); we surface the human part.
 */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const FRIENDLY: Record<string, string> = {
  network: 'You seem to be offline. Check your connection and try again.',
  not_authenticated: 'Your session has ended. Please sign in again.',
  forbidden: "You don't have permission to do that.",
  not_found: "This isn't available anymore.",
  rate_limited: 'Too many attempts. Please wait a little and try again.',
  invalid_token: 'This code is invalid or has expired.',
  unknown: 'Something went wrong. Please try again.',
  backend_not_configured: 'Sniff.in is not connected to its backend yet.',
  // Supabase Auth
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed: 'Please verify your email first.',
  user_already_exists: 'An account with this email already exists. Try signing in.',
  weak_password: 'Choose a stronger password (at least 8 characters, mixing letters and numbers).',
  otp_expired: 'That code has expired. Request a new one.',
  over_email_send_rate_limit: 'Too many emails sent. Please wait a minute and try again.',
  over_request_rate_limit: 'Too many sign-in attempts from this network. Wait a few minutes and try again.',
  captcha_failed: 'Verification expired or failed. Complete the check and try again.',
  email_address_not_authorized: 'Email delivery is not configured for this address yet. Please contact support.',
  // Media and profile RPCs
  invalid_media: "That upload couldn't be prepared. Please try again.",
  media_quota_exceeded: "You've reached your storage limit. Remove some photos or files and try again.",
  server_media_quota_exceeded: "This Server has reached its storage limit.",
  media_path_taken: 'Please try that upload again.',
  missing_upload: "The upload didn't finish. Please try again.",
  invalid_photo: "That photo couldn't be added.",
  too_many_photos: 'You can add up to 6 extra photos.',
  too_many_images: 'You can add up to 6 images.',
  invalid_viewer: "That preview isn't available.",
  server_closed: 'This Server has ended.',
  not_open_to_talk: 'Turn on Open to Talk to see people to meet.',
  not_available: 'Turn on Available to see people here.',
  account_suspended: 'Your account is suspended.',
  invalid_duration: 'Choose a duration between 1 minute and 12 hours.',
  permanent_only: 'Badges belong to permanent Servers.',
  duplicate_image: 'That image is already attached.',
  invalid_feedback: 'Add a short description (at least a few words).',
  invalid_screenshot: "That screenshot couldn't be attached.",
};

type ErrLike = { message?: string; code?: string; status?: number; name?: string };

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = (e ?? {}) as ErrLike;
  const raw = String(err.message ?? '');

  if (/network request failed|failed to fetch|fetch failed|networkerror|timed out/i.test(raw)) {
    return new AppError('network', FRIENDLY.network, e);
  }
  // Our RPC convention: "code: message" or "code".
  const m = raw.match(/^([a-z_]+)(?::\s*(.+))?$/s);
  // Postgres check/unique violations carry a SQLSTATE code; keep them distinguishable from real unknowns.
  if (err.code === '23514') return new AppError('invalid_input', 'One of the fields is too long or not allowed.', e);
  if (err.code === '23505') return new AppError('duplicate', 'That already exists.', e);
  if (m) return new AppError(m[1], m[2]?.trim() || FRIENDLY[m[1]] || FRIENDLY.unknown, e);
  // Supabase Auth errors expose a code.
  if (err.code && FRIENDLY[err.code]) return new AppError(err.code, FRIENDLY[err.code], e);
  if (/row-level security|permission denied/i.test(raw)) return new AppError('forbidden', FRIENDLY.forbidden, e);
  if (/JWT expired|invalid JWT|refresh token/i.test(raw)) {
    return new AppError('not_authenticated', FRIENDLY.not_authenticated, e);
  }
  return new AppError('unknown', FRIENDLY.unknown, e);
}

export function errorMessage(e: unknown): string {
  return toAppError(e).message;
}

/** Codes that should not be retried automatically. */
export function isPermanent(e: unknown): boolean {
  const code = toAppError(e).code;
  return code !== 'network' && code !== 'unknown';
}
