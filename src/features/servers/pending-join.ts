import * as Linking from 'expo-linking';
import { create } from 'zustand';

import { extractJoinToken } from '@/lib/validation';

/**
 * Remembers a join token from a QR/deep link opened while signed out or mid-onboarding,
 * so the user lands on the join screen once they're inside the app. Kept in memory only.
 */
export const usePendingJoin = create<{ token: string | null; set: (t: string | null) => void }>((set) => ({
  token: null,
  set: (token) => set({ token }),
}));

function handle(url: string | null) {
  if (!url || !/join/.test(url)) return;
  const token = extractJoinToken(url);
  if (token) usePendingJoin.getState().set(token);
}

let started = false;
export function capturePendingJoinLink() {
  if (started) return;
  started = true;
  Linking.getInitialURL().then(handle).catch(() => {});
  Linking.addEventListener('url', ({ url }) => handle(url));
}
