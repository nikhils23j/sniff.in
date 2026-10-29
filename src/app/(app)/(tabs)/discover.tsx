import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionMenu } from '@/components/ActionMenu';
import { ConnectSheet } from '@/components/ConnectSheet';
import { FeatureTour } from '@/components/FeatureTour';
import { CompactAvailability } from '@/components/PresenceToggles';
import { ServerAvatar } from '@/components/ServerAvatar';
import { type DeckAction, SwipeDeck } from '@/components/SwipeDeck';
import { Avatar, Button, Card, EmptyState, ErrorState, IconButton, Logo, SkeletonCard, Tag, Text, toast } from '@/components/ui';
import { useDashboard } from '@/features/discover/hooks';
import { useMySettings, useUpdateSettings } from '@/features/profile/hooks';
import { serversApi } from '@/features/servers/api';
import { useMyServers, useVenuePeople } from '@/features/servers/hooks';
import { useSelectedServer } from '@/features/servers/selection-store';
import { useDiscovery, usePendingRequestCount, usePresence, useUnreadNotificationCount } from '@/features/social/hooks';
import { gradients, useTheme } from '@/theme';
import type { ActivityPost, DashboardServer, DiscoveryCandidate, NearbyVenue, TalkMatch, VenuePerson } from '@/types/domain';

type Person = TalkMatch | VenuePerson | DiscoveryCandidate;
type HomeCard =
  | { kind: 'person'; person: Person; serverId: string; serverName: string; reason?: string }
  | { kind: 'activity'; post: ActivityPost }
  | { kind: 'server'; server: DashboardServer }
  | { kind: 'venue'; venue: NearbyVenue; distanceKm: number | null };

const cardKey = (c: HomeCard) => c.kind === 'person' ? `person-${c.person.user_id}` : c.kind === 'activity' ? `post-${c.post.id}`
  : c.kind === 'venue' ? `venue-${c.venue.server_id}` : `server-${c.server.id}`;

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function personTags(p: Person): string[] {
  const shared = 'shared_interests' in p ? p.shared_interests ?? [] : 'shared_tags' in p ? p.shared_tags : [];
  const own = 'interests' in p ? p.interests ?? [] : [];
  return [...new Set([...shared, ...own])].slice(0, 5);
}

function DeckCard({ item }: { item: HomeCard }) {
  const { colors, radius } = useTheme();
  const shell = { flex: 1, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    overflow: 'hidden' as const };
  const band = (colorsFor: readonly [string, string], label: string) => <LinearGradient colors={colorsFor} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
    style={{ height: 92, paddingHorizontal: 20, paddingTop: 16 }}>
    <Text variant="caption" style={{ color: colors.onPrimary, letterSpacing: 1.2, fontWeight: '700' }}>{label}</Text>
  </LinearGradient>;

  if (item.kind === 'person') {
    const p = item.person;
    const topic = 'talk_topic' in p ? p.talk_topic : 'topic' in p ? p.topic : null;
    const hint = 'location_hint' in p ? p.location_hint : null;
    const work = 'occupation' in p ? [p.occupation, p.university].filter(Boolean).join(' · ') : '';
    const tags = personTags(p);
    return <View style={shell}>
      {band(gradients.holi, 'PERSON TO MEET')}
      <View style={{ marginTop: -46, paddingHorizontal: 20, gap: 10, flex: 1 }}>
        <View style={{ borderRadius: 999, borderWidth: 4, borderColor: colors.surface, alignSelf: 'flex-start' }}>
          <Avatar path={p.avatar_path} name={p.display_name} size={88} available />
        </View>
        <View style={{ gap: 2 }}>
          <Text variant="title" numberOfLines={1}>{p.display_name}</Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>{work || `Open to Talk in ${item.serverName}`}</Text>
        </View>
        {topic ? <Text variant="body" numberOfLines={3}>“{topic}”</Text> : <Text variant="body" color="textSecondary">Open to a conversation right now.</Text>}
        {hint ? <Tag label={hint} small icon="location-outline" tone="accent" /> : null}
        {tags.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{tags.map((t) => <Tag key={t} label={t} small />)}</View> : null}
        {item.reason ? <Text variant="callout" color="primary" numberOfLines={2}>{item.reason}</Text> : null}
        <View style={{ flex: 1 }} />
        <Text variant="caption" color="textTertiary" style={{ marginBottom: 14 }}>Tap for full profile · in {item.serverName}</Text>
      </View>
    </View>;
  }
  if (item.kind === 'activity') {
    const p = item.post;
    return <View style={shell}>
      {band(gradients.sunrise, 'ACTIVITY FOR YOU')}
      <View style={{ padding: 20, gap: 12, flex: 1 }}>
        <Tag label={p.category} small tone="accent" />
        <Text variant="heading" numberOfLines={5}>{p.body}</Text>
        <Text variant="callout" color="textSecondary">by {p.author.display_name} · {p.server_name}</Text>
        <Text variant="callout">{p.capacity ? `${p.in_count}/${p.capacity} places taken` : `${p.in_count} in so far`}</Text>
        {p.relevance_reason ? <Text variant="callout" color="primary" numberOfLines={2}>{p.relevance_reason}</Text> : null}
        <View style={{ flex: 1 }} />
        <Text variant="caption" color="textTertiary">Tap for details · swipe right to join in</Text>
      </View>
    </View>;
  }
  if (item.kind === 'server') {
    const s = item.server;
    return <View style={shell}>
      {band(gradients.brand, s.kind === 'short_term' ? 'EVENT NEAR YOU' : 'COMMUNITY')}
      <View style={{ padding: 20, gap: 12, flex: 1 }}>
        <ServerAvatar name={s.name} category={s.category} avatarPath={s.avatar_path} size={64} />
        <Text variant="title" numberOfLines={2}>{s.name}</Text>
        <Text variant="callout" color="textSecondary">{s.member_count} members{s.city ? ` · ${s.city}` : ''}</Text>
        {s.reason ? <Text variant="callout" color="primary" numberOfLines={2}>{s.reason}</Text> : null}
        <View style={{ flex: 1 }} />
        <Text variant="caption" color="textTertiary">Tap to see the Server</Text>
      </View>
    </View>;
  }
  const v = item.venue;
  return <View style={shell}>
    {band(gradients.peacock, 'HAPPENING NEARBY')}
    <View style={{ padding: 20, gap: 12, flex: 1 }}>
      <Text variant="title" numberOfLines={2}>{v.name}</Text>
      <Text variant="heading" color="primary">{v.participants} people here · {v.open_to_talk} Open to Talk</Text>
      {item.distanceKm != null ? <Text variant="callout" color="textSecondary">
        {item.distanceKm < 1 ? `${Math.max(50, Math.round(item.distanceKm * 1000 / 50) * 50)} m away` : `${item.distanceKm.toFixed(1)} km away`}</Text> : null}
      <Text variant="caption" color="textSecondary">Live counts from people at the venue. Ends {new Date(v.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</Text>
      <View style={{ flex: 1 }} />
      <Text variant="caption" color="textTertiary">Scan the venue’s QR code to join</Text>
    </View>
  </View>;
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const unread = useUnreadNotificationCount();
  const incoming = usePendingRequestCount('incoming');
  const presence = usePresence();
  const settings = useMySettings();
  const updateSettings = useUpdateSettings();
  const servers = useMyServers();
  const relevant = useQuery({ queryKey: ['home-relevant-servers'], queryFn: serversApi.relevantForHome, refetchInterval: 60_000 });
  const selectedId = useSelectedServer((s) => s.serverId);
  const select = useSelectedServer((s) => s.select);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const relevantIds = new Set(relevant.data ?? []);
  const activeServers = (servers.data ?? []).filter((s) => s.status === 'active' && s.is_live && relevantIds.has(s.id)
    && (s.kind !== 'short_term' || !s.ends_at || new Date(s.ends_at).getTime() > now));
  const selected = activeServers.find((s) => s.id === selectedId) ?? null;
  const temporary = selected?.kind === 'short_term' ? selected : null;
  const permanent = selected?.kind === 'long_term' ? selected : null;
  const isAvailable = !!presence.data?.is_available;

  // A selected event that ended (or that we left) quietly falls back to "Everywhere".
  useEffect(() => {
    if (selectedId && servers.isSuccess && relevant.isSuccess && !selected) select(null);
  }, [selectedId, servers.isSuccess, relevant.isSuccess, selected, select]);

  const venuePeople = useVenuePeople(temporary?.id ?? '');
  const discovery = useDiscovery(permanent?.id ?? null, isAvailable);
  const dashboard = useDashboard(!selected);
  const [plusMenu, setPlusMenu] = useState(false);
  const [connectTo, setConnectTo] = useState<{ person: Person; serverId: string; serverName: string } | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Nearby venues load automatically once location was granted before; otherwise on request.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted || cancelled) return;
        const last = await Location.getLastKnownPositionAsync({ maxAge: 15 * 60_000 });
        if (last && !cancelled) setPosition({ lat: last.coords.latitude, lng: last.coords.longitude });
      } catch { /* location unavailable: the button remains */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const nearby = useQuery({ queryKey: ['venue-nearby', position?.lat.toFixed(2), position?.lng.toFixed(2)],
    queryFn: () => serversApi.nearbyVenues(position!.lat, position!.lng), enabled: !!position && !selected, staleTime: 60_000 });

  const seenServers = new Set<string>();
  const uniqueServers = [...(dashboard.data?.suggested_servers ?? []).slice(0, 4), ...(dashboard.data?.trending_servers ?? []).slice(0, 2),
    ...(dashboard.data?.popular_servers ?? []).slice(0, 4)].filter((s) => !seenServers.has(s.id) && !!seenServers.add(s.id));

  let cards: HomeCard[];
  if (temporary) {
    cards = (venuePeople.data ?? []).map((person) => ({ kind: 'person', person, serverId: temporary.id, serverName: temporary.name }));
  } else if (permanent) {
    cards = (discovery.data?.pages.flat() ?? []).map((person) => ({ kind: 'person', person, serverId: permanent.id,
      serverName: permanent.name, reason: person.reasons[0] }));
  } else {
    const people: HomeCard[] = [];
    const plans: HomeCard[] = (dashboard.data?.activities_for_you ?? []).slice(0, 6).map((post) => ({ kind: 'activity', post }));
    const venues: HomeCard[] = (nearby.data ?? []).filter((v) => v.open_to_talk > 0).map((venue) => ({ kind: 'venue', venue,
      distanceKm: position ? distanceKm(position, { lat: Number(venue.venue_lat), lng: Number(venue.venue_lng) }) : null }));
    const communities: HomeCard[] = uniqueServers.map((server) => ({ kind: 'server', server }));
    // Interleave so the deck feels varied: person, plan, venue, community, ...
    cards = [];
    for (let i = 0; i < Math.max(people.length, plans.length, venues.length, communities.length); i++) {
      for (const list of [people, venues, plans, communities]) if (list[i]) cards.push(list[i]);
    }
  }
  const loading = temporary ? venuePeople.isLoading : permanent ? isAvailable && discovery.isLoading : dashboard.isLoading;
  const error = temporary ? venuePeople.error : permanent ? (isAvailable ? discovery.error : null) : dashboard.error;

  const findNearby = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return toast.info('Location access is needed to find nearby venues.');
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      setPosition({ lat: result.coords.latitude, lng: result.coords.longitude });
    } catch (e) { toast.error(e); } finally { setLocating(false); }
  };
  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([servers.refetch(), presence.refetch(),
      temporary ? venuePeople.refetch() : permanent ? discovery.refetch() : dashboard.refetch(),
      !selected && position ? nearby.refetch() : null]);
    setRefreshing(false);
  };

  const openCard = (c: HomeCard) => {
    if (c.kind === 'person') router.push({ pathname: '/user/[id]', params: { id: c.person.user_id, serverId: c.serverId, serverName: c.serverName } });
    else if (c.kind === 'activity') router.push(`/post/${c.post.id}`);
    else if (c.kind === 'server') router.push(`/server/${c.server.id}`);
    else router.push(`/server/${c.venue.server_id}`);
  };
  const primaryFor = (c: HomeCard): DeckAction => c.kind === 'person'
    ? ('request_state' in c.person && c.person.request_state !== 'none' ? { label: 'View', icon: 'person' } : { label: 'Say hi', icon: 'hand-right' })
    : c.kind === 'activity' ? { label: 'I’m in', icon: 'checkmark' } : c.kind === 'venue' ? { label: 'Join', icon: 'qr-code' } : { label: 'Explore', icon: 'arrow-forward' };
  const onPrimary = (c: HomeCard) => {
    if (c.kind === 'person' && !('request_state' in c.person && c.person.request_state !== 'none')) {
      setConnectTo({ person: c.person, serverId: c.serverId, serverName: c.serverName });
    } else if (c.kind === 'venue') router.push('/join');
    else openCard(c);
  };

  const deckHeight = Math.min(470, Math.max(360, windowHeight * 0.52));
  const title = temporary ? `Here at ${temporary.name}` : permanent ? permanent.name : 'Home';
  const subtitle = temporary ? 'People at this venue who chose to be Open to Talk.'
    : permanent ? 'Available people in this Server.' : 'Plans, places and communities for you, right now.';

  return <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.background }}>
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 }}>
        <Logo width={110} />
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton icon="notifications-outline" label="Notifications and requests" badge={(unread.data ?? 0) + (incoming.data ?? 0)} onPress={() => router.push('/notifications')} />
            <IconButton icon="add-circle" label="Join or create a Server" onPress={() => setPlusMenu(true)} />
          </View>
          <CompactAvailability />
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        <Text variant="title" accessibilityRole="header" numberOfLines={1}>{title}</Text>
        <Text variant="callout" color="textSecondary">{subtitle}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Tag label="Everywhere" icon="sparkles-outline" selected={!selected} onPress={() => select(null)} />
          {activeServers.map((s) => <Tag key={s.id} label={s.kind === 'short_term' ? `● ${s.name}` : s.name}
            selected={selected?.id === s.id} onPress={() => select(s.id)} />)}
          <Tag label="Join" icon="add" onPress={() => router.push('/join')} />
        </ScrollView>
        {temporary ? <Card tone="brand" style={{ gap: 8 }}>
          <Text variant="callout" color="textSecondary">{venuePeople.data?.length ?? 0} others Open to Talk here</Text>
          <Button title="My status at this venue" variant="secondary" size="sm" icon="time-outline" onPress={() => router.push(`/server/${temporary.id}/presence`)} />
        </Card> : null}
      </View>

      <View style={{ paddingHorizontal: 20 }}>
        {loading ? <SkeletonCard /> : error && !cards.length ? <ErrorState error={error} onRetry={() => void refresh()} /> :
          <SwipeDeck items={cards} keyOf={cardKey} height={deckHeight} renderCard={(c) => <DeckCard item={c} />}
            primaryFor={primaryFor} onPrimary={onPrimary} onOpen={openCard}
            emptyState={<EmptyState icon={temporary ? 'people-outline' : 'sparkles-outline'}
              title={temporary ? 'No one is Open to Talk here yet' : permanent ? (isAvailable ? 'No one else is available here right now' : 'Go Available to see people')
                : activeServers.length ? 'You’re all caught up' : 'Join your first Server'}
              body={temporary ? 'Set your own status so others can find you, or check back in a few minutes.'
                : activeServers.length ? 'Pull down to refresh, browse activities, or find a venue nearby.' : 'Scan a QR code, enter an invite code, or explore communities.'}
              action={temporary ? { label: 'My status', onPress: () => router.push(`/server/${temporary.id}/presence`) }
                : activeServers.length ? { label: 'See activities', onPress: () => router.push('/(tabs)/activity') }
                : { label: 'Join a Server', icon: 'qr-code', onPress: () => router.push('/join') }} />} />}
      </View>

      {!selected ? <View style={{ paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {!position ? <Button title="Find active venues nearby" icon="location-outline" variant="secondary" size="sm" loading={locating} onPress={() => void findNearby()} /> : null}
        <Button title="Hot Map" icon="map-outline" variant="secondary" size="sm" onPress={() => router.push('/hot-map')} />
        <Button title="Explore Servers" icon="compass-outline" variant="secondary" size="sm" onPress={() => router.push('/(tabs)/servers')} />
      </View> : null}
    </ScrollView>

    <ConnectSheet visible={!!connectTo} onClose={() => setConnectTo(null)} serverId={connectTo?.serverId ?? ''} serverName={connectTo?.serverName}
      person={connectTo ? { id: connectTo.person.user_id, display_name: connectTo.person.display_name, avatar_path: connectTo.person.avatar_path } : null} />
    <ActionMenu visible={plusMenu} title="Join or create" onClose={() => setPlusMenu(false)} actions={[
      { label: 'Scan a QR code or enter an invite code', icon: 'qr-code-outline', onPress: () => router.push('/join') },
      { label: 'Create a Server', icon: 'add-circle-outline', onPress: () => router.push('/server/new') },
      { label: 'Post an activity', icon: 'megaphone-outline', onPress: () => router.push('/post/compose') },
      { label: 'Explore Servers', icon: 'compass-outline', onPress: () => router.push('/(tabs)/servers') },
    ]} />
    <FeatureTour eligible={settings.data?.intro_pending === true} onComplete={() => updateSettings.mutate({ intro_pending: false }, { onError: toast.error })} cards={[
      { icon: 'people-circle-outline', title: 'Servers are your communities', body: 'Join your campus, club, workplace, building, or event to meet people with shared context.' },
      { icon: 'megaphone-outline', title: 'Activities turn ideas into plans', body: 'Post or join a study session, game, meal, trip, or anything your community can do together.' },
      { icon: 'add-circle-outline', title: 'Start from the plus button', body: 'Use + to create or join a Server and to post a new activity.' },
    ]} />
  </View>;
}
