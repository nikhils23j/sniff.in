import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as Linking from 'expo-linking';

import { Banner, Button, ErrorState, Logo, Text } from '@/components/ui';
import { authApi } from '@/features/auth/api';
import { env } from '@/lib/env';
import { useTheme } from '@/theme';

/** Shown instead of the app when Supabase env vars are missing. We never fake a working backend. */
export function BackendNotConfigured() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 24, paddingTop: insets.top + 48, gap: 20 }}>
      <Logo width={160} />
      <Text variant="title">Backend not configured</Text>
      <Text variant="body" color="textSecondary">
        This build has no Supabase project configured, so sign-in and all social features are disabled.
      </Text>
      <Banner
        tone="warning"
        title="For developers"
        body="Copy .env.example to .env, set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart Metro with `npx expo start -c`. See docs/SETUP.md."
      />
    </View>
  );
}

/** Signed in, but the profile couldn't be loaded (offline / server error). Never guess onboarding state. */
export function StartupProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 24, paddingTop: insets.top + 48, gap: 16 }}>
      <Logo width={140} />
      <ErrorState error={error ?? new TypeError('Network request failed')} onRetry={onRetry} />
      <Button title="Sign out" variant="ghost" onPress={() => authApi.signOut()} />
    </View>
  );
}

export function AccountSuspended() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 24, paddingTop: insets.top + 48, gap: 16 }}>
      <Logo width={140} />
      <Text variant="title">Your account is suspended</Text>
      <Text variant="body" color="textSecondary">
        Your account was restricted after a review of reports against it. You can&apos;t use Sniff.in&apos;s social
        features while it&apos;s suspended. If you think this is a mistake, contact support.
      </Text>
      <Button title="Contact support" icon="mail-outline" onPress={() => Linking.openURL(`mailto:${env.supportEmail}?subject=Account%20suspension`)} />
      <Button title="Sign out" variant="secondary" onPress={() => authApi.signOut()} />
    </View>
  );
}
