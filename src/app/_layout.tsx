import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { OfflineBanner, ToastHost } from '@/components/ui';
import { AccountSuspended, BackendNotConfigured, StartupProblem } from '@/components/BackendNotConfigured';
import { capturePendingJoinLink } from '@/features/servers/pending-join';
import { startSessionListener, useSessionStore } from '@/features/auth/session-store';
import { useMe } from '@/features/profile/hooks';
import { capturePendingProfileLink } from '@/features/profile/pending-profile';
import { env } from '@/lib/env';
import { queryClient } from '@/lib/query-client';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
startSessionListener();
capturePendingJoinLink();
capturePendingProfileLink();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  // Keep the system launch surface only until fonts are ready.
  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);
  const t = useTheme();
  const navTheme = t.scheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={{ ...navTheme, colors: { ...navTheme.colors, background: t.colors.background, primary: t.colors.primary } }}>
            <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
            {fontsLoaded ? env.isBackendConfigured ? <RootNavigator /> : <BackendNotConfigured /> : null}
            <OfflineBanner />
            <ToastHost />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Routing is derived from authoritative state:
 *   no session              → (auth)
 *   recovery session        → reset-password
 *   session, not onboarded  → (onboarding)
 *   session, onboarded      → (app)
 */
function RootNavigator() {
  const session = useSessionStore((s) => s.session);
  const initialized = useSessionStore((s) => s.initialized);
  const recovering = useSessionStore((s) => s.recovering);
  const me = useMe();

  const signedIn = !!session;
  // Only an actually-loaded profile decides onboarding. Errors and offline starts must never be
  // mistaken for "not onboarded" (finishing onboarding again would overwrite the profile).
  const meLoaded = me.data !== undefined; // a failed background refetch keeps prior data
  const onboarded = !!me.data?.onboarded_at;
  const blockedOnProfile = signedIn && !meLoaded && (me.isError || me.fetchStatus === 'paused');
  const dataReady = initialized && (!signedIn || meLoaded || blockedOnProfile);
  if (!dataReady) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  if (blockedOnProfile) return <StartupProblem error={me.error} onRetry={() => me.refetch()} />;
  if (signedIn && me.data?.account_status === 'suspended') return <AccountSuspended />;

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      {/* Always-available entry point: "/" (cold start, deep links to the root) redirects by state. */}
      <Stack.Screen name="index" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && recovering}>
        <Stack.Screen name="reset-password" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !recovering && !onboarded}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !recovering && onboarded}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
