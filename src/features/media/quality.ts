import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type MediaQuality = 'small' | 'balanced' | 'best';

const KEY = 'sniffin.media-quality.v1';
let changedThisSession = false;

export const QUALITY_PRESETS: Record<MediaQuality, { edge: number; compression: number; description: string }> = {
  small: { edge: 960, compression: 0.64, description: 'Smaller files, faster on slow networks' },
  balanced: { edge: 1600, compression: 0.8, description: 'Clear photos with sensible file sizes' },
  best: { edge: 2048, compression: 0.92, description: 'More detail, more data and storage' },
};

export const useMediaQuality = create<{ mode: MediaQuality; setMode: (mode: MediaQuality) => void }>((set) => ({
  mode: 'balanced',
  setMode: (mode) => {
    changedThisSession = true;
    set({ mode });
    void AsyncStorage.setItem(KEY, mode).catch(() => {});
  },
}));

void AsyncStorage.getItem(KEY).then((value) => {
  if (!changedThisSession && (value === 'small' || value === 'balanced' || value === 'best')) {
    useMediaQuality.setState({ mode: value });
  }
}).catch(() => {});
