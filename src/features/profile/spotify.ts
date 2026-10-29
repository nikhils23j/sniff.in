import * as AuthSession from 'expo-auth-session';
import { Platform } from 'react-native';

import { registerAccountCleaner } from '@/lib/account-state';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { qk, queryClient } from '@/lib/query-client';
import { rpc } from '@/lib/rpc';
import { secureSessionStorage } from '@/lib/secure-storage';
import { supabase } from '@/lib/supabase';

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};
const redirectUri = `${env.appUrl.replace(/\/$/, '')}/spotify/callback`;
const pendingKey = (uid: string) => `sniffin.spotify.pending.${uid}`;
type Pending = { state: string; verifier: string; userId: string; redirectUri: string; startedAt: number };
let activeUser: string | null = null;
let completion: { state: string; promise: Promise<string> } | null = null;
let finished: { state: string; url: string; at: number } | null = null;

registerAccountCleaner(() => {
  if (activeUser) void secureSessionStorage.removeItem(pendingKey(activeUser)).catch(() => {});
  activeUser = null;
  completion = null;
  finished = null;
});

/** OAuth PKCE on Android. Spotify credentials never enter this app or database. */
export async function connectSpotify(userId: string): Promise<string | null> {
  if (Platform.OS !== 'android') throw new AppError('unsupported', 'Spotify connection is available in the Android app.');
  if (!env.spotifyClientId) throw new AppError('not_configured', 'Spotify connection is being prepared.');
  const request = new AuthSession.AuthRequest({
    clientId: env.spotifyClientId,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    scopes: ['user-read-private'],
    usePKCE: true,
  });
  await request.makeAuthUrlAsync(discovery);
  if (!request.codeVerifier) throw new AppError('spotify_auth_failed', 'Could not start Spotify connection.');
  activeUser = userId;
  const pending: Pending = { state: request.state, verifier: request.codeVerifier, userId, redirectUri, startedAt: Date.now() };
  await secureSessionStorage.setItem(pendingKey(userId), JSON.stringify(pending));
  const result = await request.promptAsync(discovery);
  if (result.type === 'success' && result.params.code) {
    return finishSpotifyCallback(userId, result.params.code, result.params.state);
  }
  if (finished?.state === request.state) return finished.url;
  await secureSessionStorage.removeItem(pendingKey(userId)).catch(() => {});
  if (result.type === 'cancel' || result.type === 'dismiss') return null;
  throw new AppError('spotify_auth_failed', 'Spotify connection did not complete. Please try again.');
}

/** Also handles an Android App Link that opens a fresh app process mid-flow. */
export async function finishSpotifyCallback(userId: string, code: string, state: string): Promise<string> {
  if (finished?.state === state && Date.now() - finished.at < 60_000) return finished.url;
  if (completion?.state === state) return completion.promise;
  const promise = (async () => {
    const raw = await secureSessionStorage.getItem(pendingKey(userId));
    const pending = raw ? JSON.parse(raw) as Pending : null;
    if (!pending || pending.userId !== userId || pending.state !== state ||
        pending.redirectUri !== redirectUri || Date.now() - pending.startedAt > 10 * 60_000) {
      throw new AppError('spotify_auth_expired', 'This Spotify connection expired. Start again from Edit profile.');
    }
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.user.id !== userId) throw new AppError('not_authenticated', 'Sign in again before connecting Spotify.');
    const token = await AuthSession.exchangeCodeAsync({
      clientId: env.spotifyClientId, code, redirectUri,
      extraParams: { code_verifier: pending.verifier },
    }, { tokenEndpoint: discovery.tokenEndpoint });
    const { data, error } = await supabase.functions.invoke<{ profileUrl: string }>('spotify-connect', {
      body: { accessToken: token.accessToken },
    });
    if (error || !data?.profileUrl) throw new AppError('spotify_save_failed', 'Spotify connected, but the profile could not be saved. Please try again.');
    await secureSessionStorage.removeItem(pendingKey(userId)).catch(() => {});
    finished = { state, url: data.profileUrl, at: Date.now() };
    void queryClient.invalidateQueries({ queryKey: qk.me });
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
    return data.profileUrl;
  })();
  completion = { state, promise };
  try { return await promise; }
  finally { if (completion?.promise === promise) completion = null; }
}

export async function disconnectSpotify() {
  await rpc<void>('disconnect_spotify');
  void queryClient.invalidateQueries({ queryKey: qk.me });
  void queryClient.invalidateQueries({ queryKey: ['profile'] });
}
