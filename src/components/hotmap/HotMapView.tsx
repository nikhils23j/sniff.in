import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import MapView, { Circle, Marker, type Region } from 'react-native-maps';

import { Text } from '@/components/ui';
import { cellRadiusMeters, heatFill, type LatLng } from '@/features/hotmap/geo';
import { useTheme } from '@/theme';
import type { HotCell } from '@/types/domain';

const MAX_LABELS = 80;

/**
 * iOS Hot Map (Apple Maps). Aggregated cells only: each is a translucent red circle sized to the server's grid and
 * shaded by relative intensity, with a small count label. Individuals are never shown.
 */
export function HotMapView({
  center, cells, cellDeg, onRegionChange, height,
}: { center: LatLng; cells: HotCell[]; cellDeg: number; onRegionChange: (r: Region) => void; height: number }) {
  const { scheme, colors, radius } = useTheme();
  const ref = useRef<MapView>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.animateToRegion({ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.25, longitudeDelta: 0.25 }, 600);
  }, [center.lat, center.lng]);

  const labelled = [...cells].sort((a, b) => b.people - a.people).slice(0, MAX_LABELS);
  const r = cellRadiusMeters(cellDeg);

  return (
    <View style={{ height, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      <MapView
        ref={ref}
        style={{ flex: 1 }}
        initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.25, longitudeDelta: 0.25 }}
        showsUserLocation={false}
        showsCompass={false}
        pitchEnabled={false}
        rotateEnabled={false}
        userInterfaceStyle={scheme}
        onRegionChangeComplete={onRegionChange}
        accessibilityLabel="Hot Map showing busy areas">
        {cells.map((c) => (
          <Circle
            key={`c-${c.lat}-${c.lng}`}
            center={{ latitude: Number(c.lat), longitude: Number(c.lng) }}
            radius={r}
            fillColor={heatFill(Number(c.intensity))}
            strokeColor="rgba(220, 38, 38, 0.55)"
            strokeWidth={1}
          />
        ))}
        {labelled.map((c) => (
          <Marker
            key={`m-${c.lat}-${c.lng}-${c.people_label}`}
            coordinate={{ latitude: Number(c.lat), longitude: Number(c.lng) }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            accessibilityLabel={`${c.people_label} people`}>
            <View style={{ minWidth: 28, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 12, backgroundColor: '#B91C1C', borderWidth: 1.5, borderColor: '#fff', alignItems: 'center' }}>
              <Text variant="micro" style={{ color: '#fff' }}>
                {c.people_label}
              </Text>
            </View>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}
