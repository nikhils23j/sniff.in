import { useState } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Text } from '@/components/ui';
import { env } from '@/lib/env';

/** Turnstile runs on our HTTPS page so its sitekey is bound to a real hostname. */
export function CaptchaChallenge({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey: number }) {
  const [error, setError] = useState(false);
  if (!env.turnstileSiteKey) return null;
  if (Platform.OS === 'web') return <Text variant="caption" color="textSecondary">Verification is available in the mobile app.</Text>;
  const url = `${env.captchaUrl}?sitekey=${encodeURIComponent(env.turnstileSiteKey)}`;
  return <View style={{ minHeight: 110 }}>
    <WebView key={resetKey} source={{ uri: url }} javaScriptEnabled domStorageEnabled
      onMessage={(event) => {
        try {
          const data = JSON.parse(event.nativeEvent.data) as { type: string; token?: string };
          if (data.type === 'token' && data.token) { setError(false); onToken(data.token); }
          else if (data.type === 'expired' || data.type === 'error') { setError(true); onToken(null); }
        } catch { /* Ignore unrelated messages from the page. */ }
      }}
      onError={() => { setError(true); onToken(null); }}
      style={{ height: 82, backgroundColor: 'transparent' }} />
    {error ? <Text variant="caption" color="danger">Couldn’t verify. Check your connection and try again.</Text> : null}
  </View>;
}
