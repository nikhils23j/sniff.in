import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/session-store';
import { qk } from '@/lib/query-client';

import { hotMapApi, type Bounds } from './api';

/** Bounds are rounded so small pans reuse the cache. */
export function useHotMap(bounds: Bounds | null, enabled: boolean) {
  const r = (n: number) => Math.round(n * 20) / 20;
  const key = bounds ? [r(bounds.minLat), r(bounds.minLng), r(bounds.maxLat), r(bounds.maxLng)] : [];
  return useQuery({
    queryKey: ['hot-map', ...key],
    queryFn: () => hotMapApi.cells(bounds!),
    enabled: enabled && !!bounds,
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
  });
}

export function useHotMapOptIn() {
  const uid = useUserId() ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (optIn: boolean) => hotMapApi.setOptIn(uid, optIn),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.mySettings });
      qc.invalidateQueries({ queryKey: ['hot-map'] });
    },
  });
}

export const useShareLocation = () =>
  useMutation({ mutationFn: (v: { lat: number; lng: number }) => hotMapApi.updateLocation(v.lat, v.lng) });
