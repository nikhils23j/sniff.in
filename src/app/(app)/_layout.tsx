import { router, Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';

import { usePushRegistration } from '@/features/notifications/push';
import { usePendingJoin } from '@/features/servers/pending-join';
import { usePendingProfile } from '@/features/profile/pending-profile';
import { useNotificationsRealtime, usePresence } from '@/features/social/hooks';

export default function AppLayout() {
  useNotificationsRealtime();
  usePresence(); // heartbeat + authoritative availability
  usePushRegistration();

  // A join link opened while signed out / onboarding is replayed here. If Expo Router already
  // opened /join from the same link (signed-in user), don't stack a second join modal.
  const pendingToken = usePendingJoin((s) => s.token);
  const pendingHandle = usePendingProfile((s) => s.handle);
  const pathname = usePathname();
  useEffect(() => {
    if (!pendingToken) return;
    usePendingJoin.getState().set(null);
    if (pathname !== '/join') router.push({ pathname: '/join', params: { t: pendingToken } });
  }, [pendingToken, pathname]);
  useEffect(() => {
    if (!pendingHandle) return;
    usePendingProfile.getState().set(null);
    if (pathname !== `/u/${pendingHandle}`) router.navigate({ pathname: '/u/[handle]', params: { handle: pendingHandle } });
  }, [pendingHandle, pathname]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="join" options={{ presentation: 'modal' }} />
      <Stack.Screen name="report" options={{ presentation: 'modal' }} />
      <Stack.Screen name="feedback" options={{ presentation: 'modal' }} />
      <Stack.Screen name="spotify" options={{ presentation: 'modal' }} />
      <Stack.Screen name="craving" options={{ presentation: 'modal' }} />
      <Stack.Screen name="new-message" options={{ presentation: 'modal' }} />
      <Stack.Screen name="signals" options={{ presentation: 'modal' }} />
      <Stack.Screen name="post" />
    </Stack>
  );
}
