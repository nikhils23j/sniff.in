import type { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { env } from '@/lib/env';
import { clearAccountLocalState } from '@/lib/account-state';
import { logger } from '@/lib/logger';
import { queryClient } from '@/lib/query-client';
import { secureSessionStorage } from '@/lib/secure-storage';
import { supabase } from '@/lib/supabase';

type SessionState = {
  session: Session | null;
  initialized: boolean;
  /** Set while a password-recovery session is active (user must set a new password). */
  recovering: boolean;
  setRecovering: (v: boolean) => void;
};

// Persisted so that killing the app mid-reset still forces the new-password screen on relaunch.
const RECOVERY_KEY = 'sniffin.recovering';
function persistRecovering(v: boolean) {
  if (Platform.OS === 'web') return;
  (v ? SecureStore.setItemAsync(RECOVERY_KEY, '1') : SecureStore.deleteItemAsync(RECOVERY_KEY)).catch(() => {});
}
async function readRecovering(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return (await SecureStore.getItemAsync(RECOVERY_KEY).catch(() => null)) === '1';
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  initialized: false,
  recovering: false,
  setRecovering: (v) => {
    persistRecovering(v);
    set({ recovering: v });
  },
}));

let started = false;

/** Subscribes to Supabase auth once. Session is persisted in SecureStore by the client. */
export function startSessionListener() {
  if (started) return;
  started = true;
  if (!env.isBackendConfigured) {
    useSessionStore.setState({ initialized: true });
    return;
  }
  Promise.all([supabase.auth.getSession(), readRecovering()])
    .then(([{ data }, recovering]) =>
      useSessionStore.setState({ session: data.session, recovering: !!data.session && recovering, initialized: true }))
    .catch(() => useSessionStore.setState({ session: null, initialized: true }));

  supabase.auth.onAuthStateChange((event, session) => {
    logger.info('auth_event', { event });
    if (event === 'PASSWORD_RECOVERY') useSessionStore.getState().setRecovering(true);
    const priorId = useSessionStore.getState().session?.user.id;
    const nextId = session?.user.id;
    if (event === 'SIGNED_OUT' || (priorId && priorId !== nextId)) {
      queryClient.clear(); // never leak one account's cached data into the next
      clearAccountLocalState();
      if (priorId) void secureSessionStorage.removeItem(`sniffin.profile_draft.${priorId}`).catch(() => {});
      useSessionStore.getState().setRecovering(false);
    }
    useSessionStore.setState({ session, initialized: true });
  });
}

export const useSession = () => useSessionStore((s) => s.session);
export const useUserId = () => useSessionStore((s) => s.session?.user.id ?? null);
