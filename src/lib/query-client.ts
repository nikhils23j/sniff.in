import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { isPermanent } from './errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (count, error) => !isPermanent(error) && count < 2,
    },
    mutations: { retry: false },
  },
});

// Pause/resume queries with connectivity, and refetch on app foreground.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
);
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
}

/** Central query keys so invalidation stays consistent across features. */
export const qk = {
  me: ['me'] as const,
  myTags: ['me', 'tags'] as const,
  mySettings: ['me', 'settings'] as const,
  myPrivate: ['me', 'private'] as const,
  myCraving: ['me', 'craving'] as const,
  presence: ['me', 'presence'] as const,
  isAdmin: ['me', 'platform-admin'] as const,
  profile: (id: string) => ['profile', id] as const,
  myServers: ['servers', 'mine'] as const,
  server: (id: string) => ['servers', id] as const,
  serverSearch: (q: string) => ['servers', 'search', q] as const,
  serverMembers: (id: string, status: string) => ['servers', id, 'members', status] as const,
  serverTokens: (id: string) => ['servers', id, 'tokens'] as const,
  serverStats: (id: string) => ['servers', id, 'stats'] as const,
  serverReports: (id: string | null) => ['reports', id ?? 'platform'] as const,
  serverAudit: (id: string) => ['servers', id, 'audit'] as const,
  announcements: (id: string) => ['servers', id, 'announcements'] as const,
  serverMessages: (id: string) => ['servers', id, 'messages'] as const,
  discover: (serverId: string) => ['discover', serverId] as const,
  requests: (dir: 'incoming' | 'outgoing') => ['requests', dir] as const,
  pendingRequestCount: (dir: 'incoming' | 'outgoing') => ['requests', 'count', dir] as const,
  connections: (friendsOnly: boolean) => ['connections', friendsOnly] as const,
  conversations: ['conversations'] as const,
  chatBadge: ['chat-badge'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  activity: (serverId: string | null) => ['activity', serverId ?? 'all'] as const,
  postResponses: (postId: string) => ['activity', 'responses', postId] as const,
  notifications: ['notifications'] as const,
  blocked: ['blocked'] as const,
  endorsements: ['me', 'endorsements'] as const,
  flags: ['flags'] as const,
  avatar: (path: string) => ['avatar', path] as const,
  icebreakers: (connectionId: string) => ['icebreakers', connectionId] as const,
};
