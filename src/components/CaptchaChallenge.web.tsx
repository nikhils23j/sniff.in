import { useEffect, useRef, useState } from 'react';

import { Text } from '@/components/ui';
import { env } from '@/lib/env';

/** The hosted widget works in Expo Web too; only our own iframe may supply a token. */
export function CaptchaChallenge({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!env.turnstileSiteKey) return;
    const expectedOrigin = new URL(env.captchaUrl).origin;
    const receive = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.source !== frame.current?.contentWindow) return;
      try {
        const data = JSON.parse(event.data) as { type: string; token?: string };
        if (data.type === 'token' && data.token) { setError(false); onToken(data.token); }
        else if (data.type === 'expired' || data.type === 'error') { setError(true); onToken(null); }
      } catch { /* Ignore messages from other scripts in the frame. */ }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onToken, resetKey]);
  if (!env.turnstileSiteKey) return null;
  const url = `${env.captchaUrl}?sitekey=${encodeURIComponent(env.turnstileSiteKey)}`;
  return <>
    <iframe key={resetKey} ref={frame} title="Verify you are human" src={url}
      style={{ width: '100%', height: 110, border: 0, background: 'transparent' }} />
    {error ? <Text variant="caption" color="danger">Couldn’t verify. Check your connection and try again.</Text> : null}
  </>;
}
