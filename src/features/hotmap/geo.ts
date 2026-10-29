import * as Location from 'expo-location';
import { useQueries } from '@tanstack/react-query';

import type { HotCell } from '@/types/domain';

import { cellForSpan, type Bounds } from './api';

export type LatLng = { lat: number; lng: number };

export const CITIES: { key: string; label: string; lat: number; lng: number }[] = [
  { key: 'bengaluru', label: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { key: 'mumbai', label: 'Mumbai', lat: 19.076, lng: 72.8777 },
  { key: 'delhi', label: 'Delhi NCR', lat: 28.6139, lng: 77.209 },
  { key: 'hyderabad', label: 'Hyderabad', lat: 17.385, lng: 78.4867 },
  { key: 'chennai', label: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { key: 'pune', label: 'Pune', lat: 18.5204, lng: 73.8567 },
  { key: 'kolkata', label: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { key: 'kanpur', label: 'Kanpur', lat: 26.4499, lng: 80.3319 },
];

export const DEFAULT_CITY = CITIES[0];

export function boundsAround(c: LatLng, half: number): Bounds {
  return { minLat: c.lat - half, maxLat: c.lat + half, minLng: c.lng - half, maxLng: c.lng + half };
}

export function boundsFromRegion(r: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }): Bounds {
  return {
    minLat: r.latitude - r.latitudeDelta / 2, maxLat: r.latitude + r.latitudeDelta / 2,
    minLng: r.longitude - r.longitudeDelta / 2, maxLng: r.longitude + r.longitudeDelta / 2,
  };
}

/** Circle radius (metres) for a cell of the grid the server clustered with. 1° of latitude ≈ 111 km. */
export function cellRadiusMeters(cellDeg: number): number {
  return (cellDeg * 111_000) / 2;
}

export const gridFor = (b: Bounds) => cellForSpan(b.maxLat - b.minLat);

export function gridLabel(cellDeg: number): string {
  if (cellDeg <= 0.011) return 'about 1 km';
  return `about ${Math.round(cellDeg * 111)} km`;
}

export function heatFill(intensity: number): string {
  const i = Math.max(0, Math.min(1, intensity));
  return `rgba(220, 38, 38, ${(0.15 + 0.6 * i).toFixed(2)})`;
}

export function latestAsOf(cells: HotCell[]): Date | null {
  let max = 0;
  for (const c of cells) {
    const t = new Date(c.as_of).getTime();
    if (t > max) max = t;
  }
  return max ? new Date(max) : null;
}

function placeFrom(a: Location.LocationGeocodedAddress | undefined): string | null {
  if (!a) return null;
  const parts = [a.district ?? a.subregion, a.city].filter((x): x is string => !!x && x.trim().length > 0);
  const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
  if (uniq.length) return uniq.slice(0, 2).join(', ');
  return a.region ?? null;
}

const key = (c: { lat: number; lng: number }) => `${Number(c.lat).toFixed(3)},${Number(c.lng).toFixed(3)}`;

/**
 * Human place names for cells (reverse geocoding). Cached per cell for the session (TanStack Query, infinite
 * staleTime) so list re-sorts and refetches never re-geocode. Failures resolve to null → callers show coordinates.
 */
export function usePlaceNames(cells: { lat: number; lng: number }[]): Record<string, string | null | undefined> {
  const results = useQueries({
    queries: cells.map((c) => ({
      queryKey: ['geocode', key(c)],
      queryFn: async (): Promise<string | null> => {
        try {
          const out = await Location.reverseGeocodeAsync({ latitude: Number(c.lat), longitude: Number(c.lng) });
          return placeFrom(out[0]);
        } catch {
          return null;
        }
      },
      staleTime: Infinity,
      gcTime: 24 * 60 * 60_000,
      retry: false,
    })),
  });
  const map: Record<string, string | null | undefined> = {};
  cells.forEach((c, i) => {
    const r = results[i];
    map[key(c)] = r.isLoading ? undefined : (r.data ?? null);
  });
  return map;
}

export const cellKey = key;

export function coordsLabel(c: { lat: number; lng: number }): string {
  return `${Number(c.lat).toFixed(2)}°, ${Number(c.lng).toFixed(2)}°`;
}
