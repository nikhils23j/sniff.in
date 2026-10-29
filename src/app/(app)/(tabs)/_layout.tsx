import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { Avatar } from '@/components/ui';
import { useMe } from '@/features/profile/hooks';
import { useChatBadge } from '@/features/social/hooks';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const { colors } = useTheme();
  const { data: unread = 0 } = useChatBadge();
  const me = useMe();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.textSecondary, tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' }, tabBarItemStyle: { paddingTop: 4 } }}>
    <Tabs.Screen name="discover" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={String(color)} size={size} /> }} />
    <Tabs.Screen name="servers" options={{ title: 'Servers', tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={String(color)} size={size} /> }} />
    <Tabs.Screen name="activity" options={{ title: 'Activities', tabBarIcon: ({ color, size }) => <Ionicons name="megaphone-outline" color={String(color)} size={size} /> }} />
    <Tabs.Screen name="chats" options={{ title: 'Chats', tabBarBadge: unread > 0 ? (unread > 9 ? '9+' : unread) : undefined,
      tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={String(color)} size={size} /> }} />
    <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: () => <Avatar path={me.data?.avatar_path} name={me.data?.display_name ?? 'Me'} size={28} /> }} />
  </Tabs>;
}
