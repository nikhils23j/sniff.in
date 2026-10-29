import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { env } from './env';
import { secureSessionStorage } from './secure-storage';

/**
 * The single Supabase client. It only ever holds the publishable anon key; every privilege is
 * enforced by Postgres RLS / SECURITY DEFINER RPCs on the server.
 */
export const supabase = createClient(
  env.supabaseUrl || 'https://not-configured.invalid',
  env.supabaseAnonKey || 'not-configured',
  {
    auth: {
      storage: secureSessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    realtime: { params: { eventsPerSecond: 10 } },
  },
);

// Only refresh tokens while the app is foregrounded (recommended for React Native).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
