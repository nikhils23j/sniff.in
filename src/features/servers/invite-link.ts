import Constants from 'expo-constants';

import type { JoinToken } from '@/types/domain';

/** Use the configured universal-link domain, falling back to the app's custom scheme. */
export function serverInviteUrl(token: string): string {
  const domain = (Constants.expoConfig?.extra as { appLinkDomain?: string | null } | undefined)?.appLinkDomain;
  return domain ? `https://${domain}/join?t=${encodeURIComponent(token)}` : `sniffin://join?t=${encodeURIComponent(token)}`;
}

export function findActiveLinkToken(tokens: JoinToken[]): JoinToken | undefined {
  const now = Date.now();
  return tokens.find((token) => token.kind === 'link' && !token.revoked_at &&
    (!token.expires_at || new Date(token.expires_at).getTime() > now) &&
    (token.max_uses === null || token.use_count < token.max_uses));
}
