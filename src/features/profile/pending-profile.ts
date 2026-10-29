import * as Linking from 'expo-linking';
import { create } from 'zustand';

export const usePendingProfile = create<{ handle: string | null; set: (handle: string | null) => void }>((set) => ({
  handle: null, set: (handle) => set({ handle }),
}));

function capture(url: string | null) {
  if (!url) return;
  const match = url.match(/(?:\/|:\/\/)@([a-z0-9_]{3,20})(?:[?#/]|$)/i);
  if (match) usePendingProfile.getState().set(match[1].toLowerCase());
}

let started = false;
export function capturePendingProfileLink() {
  if (started) return;
  started = true;
  Linking.getInitialURL().then(capture).catch(() => {});
  Linking.addEventListener('url', ({ url }) => capture(url));
}
