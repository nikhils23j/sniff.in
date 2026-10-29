import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import type { Region } from 'react-native-maps';

import { HotMapView } from '@/components/hotmap/HotMapView';
import { AppHeader, Banner, Button, Card, EmptyState, ErrorState, Screen, Tag, Text, toast } from '@/components/ui';
import { boundsSpan, clampBounds, HOT_MAP_MAX_SPAN, type Bounds } from '@/features/hotmap/api';
import { boundsAround, boundsFromRegion, CITIES, DEFAULT_CITY, type LatLng } from '@/features/hotmap/geo';
import { useHotMap } from '@/features/hotmap/hooks';
import { useTheme } from '@/theme';

export default function HotMapScreen() {
  const { colors } = useTheme();
  const [center, setCenter] = useState<LatLng>(DEFAULT_CITY);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [regionBounds, setRegionBounds] = useState<Bounds | null>(null);
  const rawBounds = useMemo(() => regionBounds ?? boundsAround(center, 0.25), [regionBounds, center]);
  // The server only aggregates views up to 20° wide; zoomed further out we ask for the centre and hint to zoom in.
  const zoomedOut = boundsSpan(rawBounds) > HOT_MAP_MAX_SPAN;
  const bounds = useMemo(() => clampBounds(rawBounds), [rawBounds]);
  const cells = useHotMap(bounds, true);

  const nearby = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) { toast.info('Choose a city below to browse venue activity.'); return; }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      setCenter({ lat: location.coords.latitude, lng: location.coords.longitude });
      setRegionBounds(null);
      setSelectedCity(null);
    } catch (error) { toast.error(error); }
    finally { setLocating(false); }
  };
  const chooseCity = (city: (typeof CITIES)[number]) => {
    setSelectedCity(city.key);
    setCenter({ lat: city.lat, lng: city.lng });
    setRegionBounds(null);
  };
  const onRegion = (region: Region) => setRegionBounds(boundsFromRegion(region));

  return <Screen header={<AppHeader title="Hot Map" />} onRefresh={() => { void cells.refetch(); }} refreshing={cells.isRefetching}>
    <Banner tone="info" icon="people-outline" body="Heat shows recent participation at listed temporary venues. A venue appears only when at least three people have an active session. Your device location is only used to choose a map area." />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Button title="Near me" size="sm" variant={!selectedCity ? 'primary' : 'secondary'} loading={locating} onPress={() => void nearby()} />
      {CITIES.map((city) => <Button key={city.key} title={city.label} size="sm" variant={selectedCity === city.key ? 'primary' : 'secondary'} onPress={() => chooseCity(city)} />)}
    </View>
    {Platform.OS === 'ios' ? <HotMapView center={center} cells={cells.data ?? []} cellDeg={0.003} onRegionChange={onRegion} height={380} /> : null}
    <Text variant="heading" accessibilityRole="header">Active venues</Text>
    {zoomedOut ? <Banner tone="info" icon="search-outline" body="Zoom in to see activity. The map shows venues for an area up to about 2,000 km across." /> : null}
    {cells.isLoading ? <Text variant="callout" color="textSecondary">Loading venue activity…</Text> :
      cells.isError ? <ErrorState error={cells.error} onRetry={() => cells.refetch()} /> :
      !cells.data?.length ? (zoomedOut
        ? <EmptyState icon="search-outline" title="Zoom in to see activity" body="Pinch to zoom in on a city, or choose one above." />
        : <EmptyState title="No active venues here" body="Choose another city or check back when more people have joined temporary Servers." />) :
      cells.data.map((cell, index) => <Card key={cell.server_ids?.join('-') ?? index} style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: `rgba(220,38,38,${Math.max(0.22, Number(cell.intensity))})`, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="caption" style={{ color: '#fff' }}>{index + 1}</Text>
          </View>
          <View style={{ flex: 1 }}><Text variant="subheading">{cell.server_names?.join(' · ') ?? 'Temporary venue'}</Text>
            <Text variant="caption" color="textSecondary">{cell.people_label} people here recently</Text></View>
          <Tag label="Active" tone="accent" small />
        </View>
        {cell.server_ids?.[0] ? <Button title="View venue" size="sm" variant="secondary" onPress={() => router.push(`/server/${cell.server_ids![0]}`)} /> : null}
      </Card>)}
    <Text variant="caption" style={{ color: colors.textTertiary }}>Counts are grouped to protect privacy and update as sessions expire. No person’s precise location is shown.</Text>
  </Screen>;
}
