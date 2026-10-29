import { Redirect } from 'expo-router';

import { useSessionStore } from '@/features/auth/session-store';
import { useMe } from '@/features/profile/hooks';

/**
 * Root entry point. The root layout only renders the navigator once session + profile state are
 * known, so this can route deterministically. Guards in the layout still enforce access.
 */
export default function Index() {
  const session = useSessionStore((s) => s.session);
  const recovering = useSessionStore((s) => s.recovering);
  const me = useMe();
  if (!session) return <Redirect href="/welcome" />;
  if (recovering) return <Redirect href="/reset-password" />;
  if (!me.data?.onboarded_at) return <Redirect href="/location" />;
  return <Redirect href="/discover" />;
}
