import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { TalkDurationPicker } from '@/components/TalkDurationPicker';
import { AppHeader, Button, Card, EmptyState, ErrorState, LoadingList, Screen, Text, TextField, confirm, toast } from '@/components/ui';
import { useEndVenueSession, useMyVenueSession, useServer, useSetVenueSession } from '@/features/servers/hooks';
import {
  DEFAULT_TALK_DURATION, TALK_MAX_MINUTES, formatClock, minutesUntil, resolveTalkMinutes, type TalkDuration,
} from '@/features/servers/presets';
import { useSelectedServer } from '@/features/servers/selection-store';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/theme';
import type { VenueSession } from '@/types/domain';

function left(minutes: number) {
  if (minutes < 1) return 'less than a minute left';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${[h ? `${h} h` : null, m ? `${m} min` : null].filter(Boolean).join(' ')} left`;
}

export default function VenuePresenceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const server = useServer(id);
  const s = server.data;
  const eligible = !!s && s.kind === 'short_term' && s.membership?.status === 'active' && s.is_live;
  const session = useMyVenueSession(eligible ? id : '');
  const header = <AppHeader title="Open to Talk" subtitle={s?.name} />;

  if (server.isLoading || (eligible && session.isLoading)) return <Screen header={header}><LoadingList count={2} /></Screen>;
  if (server.isError || !s) return <Screen header={header}><ErrorState error={server.error} onRetry={server.refetch} /></Screen>;
  if (!eligible) {
    const ended = s.kind === 'short_term' && !s.is_live;
    return (
      <Screen header={header}>
        <EmptyState
          icon={ended ? 'time-outline' : 'chatbubbles-outline'}
          title={ended ? 'This event has ended' : 'Not available here'}
          body={ended ? 'Open to Talk closes when a temporary Server ends.' : 'Open to Talk at a venue works in temporary Servers you have joined.'}
          action={{ label: 'Back to Server', onPress: () => router.back() }}
        />
      </Screen>
    );
  }
  if (session.isError) return <Screen header={header}><ErrorState error={session.error} onRetry={session.refetch} /></Screen>;
  return <VenuePresenceForm key={`${id}-${session.data?.starts_at ?? 'none'}`} id={id} serverName={s.name} endsAt={s.ends_at}
    session={session.data ?? null} />;
}

function VenuePresenceForm({ id, serverName, endsAt, session }: {
  id: string; serverName: string; endsAt: string | null; session: VenueSession | null;
}) {
  const { colors } = useTheme();
  const set = useSetVenueSession(id);
  const end = useEndVenueSession(id);
  const select = useSelectedServer((x) => x.select);
  const now = useNow(15_000);
  const [duration, setDuration] = useState<TalkDuration>(DEFAULT_TALK_DURATION);
  const [topic, setTopic] = useState(session?.topic ?? '');
  const [hint, setHint] = useState(session?.location_hint ?? '');

  const active = !!session && new Date(session.ends_at).getTime() > now;
  const open = active && !!session?.open_to_talk;
  const remaining = session ? minutesUntil(session.ends_at, now) ?? 0 : 0;

  const save = () => {
    const r = resolveTalkMinutes(duration, minutesUntil(endsAt, Date.now()));
    if ('error' in r) return toast.error(r.error);
    set.mutate({ open: true, minutes: r.minutes, topic: topic.trim() || null, locationHint: hint.trim() || null }, {
      onSuccess: (res) => toast.success(`Open to Talk until ${formatClock(res.ends_at)}`),
      onError: toast.error,
    });
  };

  // Pausing keeps the visit (counted as present) for the rest of its current window.
  const stop = () => {
    const minutes = Math.min(Math.max(remaining, 1), TALK_MAX_MINUTES);
    set.mutate({ open: false, minutes, topic: session?.topic ?? null, locationHint: session?.location_hint ?? null }, {
      onSuccess: () => toast.success("You're no longer Open to Talk here"),
      onError: toast.error,
    });
  };

  const leaveVenue = async () => {
    const ok = await confirm({
      title: 'End your visit?',
      message: `You'll stop appearing at ${serverName} and won't count as present. You stay a member and can start again any time while it's live.`,
      confirmLabel: 'End visit',
      destructive: true,
    });
    if (!ok) return;
    end.mutate(undefined, {
      onSuccess: () => {
        toast.success('Your visit has ended');
        setTopic('');
        setHint('');
      },
      onError: toast.error,
    });
  };

  return (
    <Screen header={<AppHeader title="Open to Talk" subtitle={serverName} />}>
      <Card tone={open ? 'brand' : undefined} style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name={open ? 'chatbubbles' : active ? 'location-outline' : 'chatbubbles-outline'} size={20}
            color={open ? colors.primary : colors.textSecondary} />
          <Text variant="heading" style={{ flex: 1 }} accessibilityLiveRegion="polite">
            {open ? `Open to Talk until ${formatClock(session!.ends_at)}` : active ? "You're here, not Open to Talk" : 'Not Open to Talk'}
          </Text>
        </View>
        {active ? (
          <Text variant="callout" color="textSecondary">
            {open
              ? `${left(remaining)}. It switches off automatically.`
              : `Your visit counts until ${formatClock(session!.ends_at)} (${left(remaining)}).`}
          </Text>
        ) : (
          <Text variant="callout" color="textSecondary">
            Only members who opt in appear in on-site people cards. Your visit may still count in anonymous venue totals.
          </Text>
        )}
        {open && (session?.topic || session?.location_hint) ? (
          <View style={{ gap: 2, marginTop: 4 }}>
            {session?.topic ? <Text variant="callout">Talking about: {session.topic}</Text> : null}
            {session?.location_hint ? <Text variant="callout">Find me: {session.location_hint}</Text> : null}
          </View>
        ) : null}
      </Card>

      <Card style={{ gap: 12 }}>
        <TalkDurationPicker
          value={duration}
          onChange={setDuration}
          endsAt={endsAt}
          label={open ? 'Change how long' : 'Be Open to Talk for'}
        />
        <TextField label="What do you want to talk about?" value={topic} onChangeText={setTopic}
          maxCount={140} placeholder="A quick coffee, music, campus life…" />
        <TextField label="How to find you (optional)" value={hint} onChangeText={setHint}
          maxCount={100} placeholder="Find me at table 18" hint="e.g. “I'm across the hallway at the last table.”" />
        <Button
          title={open ? 'Update' : 'Start Open to Talk'}
          icon={open ? 'checkmark' : 'chatbubbles'}
          loading={set.isPending && set.variables?.open === true}
          disabled={set.isPending || end.isPending}
          onPress={save}
        />
        {open ? (
          <Button title="Stop Open to Talk" variant="secondary" icon="pause-outline"
            loading={set.isPending && set.variables?.open === false} disabled={set.isPending || end.isPending} onPress={stop} />
        ) : null}
      </Card>

      <View style={{ gap: 8 }}>
        <Text variant="caption" color="textSecondary">
          Your topic and location hint are visible only to members of this Server while you&apos;re Open to Talk, and disappear when it ends.
        </Text>
        <Button title="See people here" variant="secondary" icon="people-outline" onPress={() => { select(id); router.navigate('/discover'); }} />
        {active ? (
          <Button title="Leave venue / end my visit" variant="danger" icon="exit-outline" loading={end.isPending}
            disabled={set.isPending} onPress={leaveVenue} />
        ) : null}
      </View>
    </Screen>
  );
}
