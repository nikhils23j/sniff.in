import { router } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/** The auth browser normally consumes this deep link; this screen covers Android's parallel router delivery. */
export default function AuthCallbackScreen() {
  const t = useTheme();
  return <Screen scroll={false} contentStyle={{ justifyContent: 'center', gap: 16 }}>
    <View style={{ alignItems: 'center', gap: 16 }}>
      <ActivityIndicator color={t.colors.primary} />
      <Text variant="heading" align="center">Finishing sign-in…</Text>
      <Text color="textSecondary" align="center">You’ll continue automatically when your session is ready.</Text>
      <Button title="Back to sign-in" variant="ghost" onPress={() => router.replace('/continue')} />
    </View>
  </Screen>;
}
