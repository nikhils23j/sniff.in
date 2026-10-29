import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { AppHeader, Button, Screen, Text } from '@/components/ui';
import { useUserId } from '@/features/auth/session-store';
import { finishSpotifyCallback } from '@/features/profile/spotify';

const one = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;

export default function SpotifyCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const uid = useUserId();
  const [message, setMessage] = useState<string | null>(null);
  const code = one(params.code);
  const state = one(params.state);
  const invalid = !code || !state || !!params.error;
  useEffect(() => {
    if (!uid || invalid || !code || !state) return;
    let cancelled = false;
    finishSpotifyCallback(uid, code, state).then(() => {
      if (!cancelled) router.replace('/profile/edit');
    }).catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Could not connect Spotify.'); });
    return () => { cancelled = true; };
  }, [uid, code, state, invalid]);
  return <Screen header={<AppHeader title="Spotify" />}>
    <Text variant="heading">{message ?? (invalid ? 'Spotify connection was cancelled.' : 'Finishing Spotify connection…')}</Text>
    <Button title="Back to profile" onPress={() => router.replace('/profile/edit')} />
  </Screen>;
}
