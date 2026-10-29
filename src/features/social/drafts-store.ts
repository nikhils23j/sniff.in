import { Platform } from 'react-native';
import { create } from 'zustand';

import { useSessionStore } from '@/features/auth/session-store';
import { registerAccountCleaner } from '@/lib/account-state';
import { secureSessionStorage } from '@/lib/secure-storage';

type DraftsState = {
  ownerId: string | null;
  drafts: Record<string, string>;
  setDraft: (conversationId: string, text: string) => void;
  clearDraft: (conversationId: string) => void;
};

const key = (uid: string) => `sniffin.chat_drafts.${uid}`;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (Platform.OS === 'web') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const { ownerId, drafts } = useDraftsStore.getState();
    if (ownerId) void secureSessionStorage.setItem(key(ownerId), JSON.stringify(drafts)).catch(() => {});
  }, 350);
}

export const useDraftsStore = create<DraftsState>((set) => ({
  ownerId: null,
  drafts: {},
  setDraft: (conversationId, text) => {
    const uid = useSessionStore.getState().session?.user.id;
    if (!uid) return;
    set((s) => {
      const drafts = s.ownerId === uid ? s.drafts : {};
      if (!text) {
        const { [conversationId]: _removed, ...rest } = drafts;
        return { ownerId: uid, drafts: rest };
      }
      return { ownerId: uid, drafts: { ...drafts, [conversationId]: text.slice(0, 2000) } };
    });
    scheduleSave();
  },
  clearDraft: (conversationId) => {
    set((s) => {
      const { [conversationId]: _removed, ...rest } = s.drafts;
      return { drafts: rest };
    });
    scheduleSave();
  },
}));

export async function hydrateDraftsForAccount(uid: string) {
  if (useDraftsStore.getState().ownerId === uid || Platform.OS === 'web') return;
  useDraftsStore.setState({ ownerId: uid, drafts: {} });
  const raw = await secureSessionStorage.getItem(key(uid)).catch(() => null);
  if (!raw || useDraftsStore.getState().ownerId !== uid) return;
  try {
    const saved = JSON.parse(raw) as Record<string, string>;
    const safe = Object.fromEntries(Object.entries(saved).filter(([id, value]) =>
      /^[0-9a-f-]{36}$/i.test(id) && typeof value === 'string').slice(0, 30).map(([id, value]) => [id, value.slice(0, 2000)]));
    useDraftsStore.setState((s) => ({ drafts: { ...safe, ...s.drafts } }));
  } catch { /* Damaged local draft is ignored. */ }
}

registerAccountCleaner(() => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const owner = useDraftsStore.getState().ownerId;
  useDraftsStore.setState({ ownerId: null, drafts: {} });
  if (owner && Platform.OS !== 'web') void secureSessionStorage.removeItem(key(owner)).catch(() => {});
});
