/**
 * Public (client-safe) configuration. EXPO_PUBLIC_* values are inlined into the bundle at build time,
 * so ONLY publishable values may live here: never service-role keys, DB passwords or AI keys.
 * Each variable must be referenced literally (process.env.EXPO_PUBLIC_X) for inlining to work.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  isBackendConfigured: /^https:\/\/.+/.test(supabaseUrl) && supabaseAnonKey.length > 20,
  appUrl: process.env.EXPO_PUBLIC_APP_URL || 'https://sniff.in',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'support@sniff.in',
  appEnv: (process.env.EXPO_PUBLIC_APP_ENV || 'development') as 'development' | 'staging' | 'production',
  turnstileSiteKey: process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || '',
  captchaUrl: process.env.EXPO_PUBLIC_CAPTCHA_URL || 'https://sniff.in/captcha/',
  spotifyClientId: process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID || '',
} as const;
