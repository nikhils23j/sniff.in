import { create } from 'zustand';
import { registerAccountCleaner } from '@/lib/account-state';

/** Which Server the Discover tab is looking at (UI state only). */
export const useSelectedServer = create<{ serverId: string | null; select: (id: string | null) => void }>((set) => ({
  serverId: null,
  select: (serverId) => set({ serverId }),
}));

registerAccountCleaner(() => useSelectedServer.setState({ serverId: null }));
