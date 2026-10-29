import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/** Persisted "the intro story has been seen/skipped" flag, so onboarding restarts go straight to about-you. */
export const STORY_SEEN_KEY = 'sniffin.story.seen';

type SeenState = { seen: boolean | null; markSeen: () => void };

export const useStorySeen = create<SeenState>((set) => ({
  seen: null, // null while AsyncStorage is being read
  markSeen: () => {
    set({ seen: true });
    AsyncStorage.setItem(STORY_SEEN_KEY, '1').catch(() => {});
  },
}));

AsyncStorage.getItem(STORY_SEEN_KEY)
  .then((v) => useStorySeen.setState((s) => ({ seen: s.seen === true ? true : v === '1' })))
  .catch(() => useStorySeen.setState((s) => ({ seen: s.seen ?? false })));
