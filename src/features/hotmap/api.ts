import { rpc, run } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';
import type { HotCell } from '@/types/domain';

export type Bounds = { minLat: number; minLng: number; maxLat: number; maxLng: number };

/** Grid size for clustering, chosen from the visible map span (degrees). */
export function cellForSpan(latSpan: number): number {
  if (latSpan > 8) return 1;
  if (latSpan > 3) return 0.5;
  if (latSpan > 0.8) return 0.1;
  if (latSpan > 0.2) return 0.05;
  return 0.01;
}

/** venue_hot_map returns nothing for a view wider than 20° (privacy + cost), so never ask for more. */
export const HOT_MAP_MAX_SPAN = 20;

export const boundsSpan = (b: Bounds) => Math.max(b.maxLat - b.minLat, b.maxLng - b.minLng);

/** Shrinks bounds around their centre so neither side exceeds the server's max span (with a little headroom). */
export function clampBounds(b: Bounds, maxSpan = HOT_MAP_MAX_SPAN - 0.1): Bounds {
  const half = maxSpan / 2;
  const cLat = (b.minLat + b.maxLat) / 2;
  const cLng = (b.minLng + b.maxLng) / 2;
  const latHalf = Math.min((b.maxLat - b.minLat) / 2, half);
  const lngHalf = Math.min((b.maxLng - b.minLng) / 2, half);
  return {
    minLat: Math.max(-90, cLat - latHalf), maxLat: Math.min(90, cLat + latHalf),
    minLng: Math.max(-180, cLng - lngHalf), maxLng: Math.min(180, cLng + lngHalf),
  };
}

export const hotMapApi = {
  cells: (b: Bounds) =>
    rpc<HotCell[]>('venue_hot_map', {
      p_min_lat: b.minLat, p_min_lng: b.minLng, p_max_lat: b.maxLat, p_max_lng: b.maxLng,
    }),
  setOptIn: (userId: string, optIn: boolean) =>
    run(supabase.from('user_settings').update({ hot_map_opt_in: optIn }).eq('user_id', userId)),
  /** Sends coordinates; the server rounds them to a ~1 km cell and stores only that (expires in 30 min). */
  updateLocation: (lat: number, lng: number) => rpc<{ shared: boolean }>('update_my_location', { p_lat: lat, p_lng: lng }),
  clear: () => rpc<void>('clear_my_location'),
};
