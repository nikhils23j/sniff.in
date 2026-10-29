import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { toast } from '@/components/ui';
import { toAppError } from '@/lib/errors';

import type { LatLng } from './geo';
import { useShareLocation } from './hooks';

export type ShareStatus = 'idle' | 'shared' | 'not_available' | 'error';

const SHARE_EVERY_MS = 10 * 60_000;

/**
 * While the screen is focused and the user has opted in with permission: read a coarse foreground position and send
 * it once on open, then every ~10 minutes. No background tracking; stops as soon as the screen loses focus. The
 * server rounds to ~1 km and expires the cell after 30 minutes.
 */
export function useHotMapSharing(active: boolean, onPosition: (p: LatLng) => void) {
  const share = useShareLocation();
  const [status, setStatus] = useState<ShareStatus>('idle');
  const { mutateAsync } = share;

  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      let cancelled = false;
      let busy = false;
      const tick = async () => {
        if (busy) return;
        busy = true;
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (cancelled) return;
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          onPosition(p);
          const res = await mutateAsync(p);
          if (!cancelled) setStatus(res.shared ? 'shared' : 'not_available');
        } catch (e) {
          if (cancelled) return;
          setStatus('error');
          if (toAppError(e).code !== 'not_opted_in') toast.error(e);
        } finally {
          busy = false;
        }
      };
      void tick();
      const id = setInterval(() => { void tick(); }, SHARE_EVERY_MS);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }, [active, mutateAsync, onPosition]),
  );

  return { status: active ? status : ('idle' as ShareStatus), sharing: share.isPending };
}
