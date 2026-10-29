import Ionicons from '@expo/vector-icons/Ionicons';
import { formatDistanceToNow } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ServerAvatar } from '@/components/ServerAvatar';
import { ServerManagementPanel } from '@/components/ServerManagementPanel';
import { KIND_LABEL } from '@/components/ServerCard';
import { RolesExplainer } from '@/components/ServerRoles';
import {
  AppHeader, Banner, Button, Card, EmptyState, ErrorState, ListGroup, LoadingList, Screen, SectionHeader, SwitchRow, Tag, TagList,
  Text, TextField, VerifiedBadge, confirm, toast,
} from '@/components/ui';
import {
  useAnnouncements, useLeaveServer, useMyVenueSession, useRecordVisit, useRequestToJoin, useServer, useSetDiscoverable, useSetServerProfile,
} from '@/features/servers/hooks';
import { CATEGORY_LABEL, formatClock, formatDateTime } from '@/features/servers/presets';
import { useSelectedServer } from '@/features/servers/selection-store';
import { toAppError } from '@/lib/errors';
import { useTheme } from '@/theme';

export default function ServerDetailScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const server = useServer(id);
  const s = server.data;
  const member = s?.membership?.status === 'active';
  const announcements = useAnnouncements(member || s?.can_manage ? id : '');
  const leave = useLeaveServer();
  const request = useRequestToJoin();
  const setDiscoverable = useSetDiscoverable(id);
  const setProfile = useSetServerProfile(id);
  const [memberNote, setMemberNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const liveVenue = member && s?.kind === 'short_term' && s.is_live && (!s.starts_at || new Date(s.starts_at).getTime() <= now);
  const venueSession = useMyVenueSession(liveVenue ? id : '');
  const select = useSelectedServer((x) => x.select);
  const recordVisit = useRecordVisit();
  const visitedId = useRef<string | null>(null);
  // Count one visit per Server view (feeds Trending). Failures are irrelevant to the user, so they are ignored.
  const visible = !!s && s.membership?.status !== 'banned';
  const { mutate: sendVisit } = recordVisit;
  useEffect(() => {
    if (!visible || !id || visitedId.current === id) return;
    visitedId.current = id;
    sendVisit(id, { onError: () => {} });
  }, [visible, id, sendVisit]);

  if (server.isLoading) {
    return (
      <Screen header={<AppHeader title="Server" />}>
        <LoadingList count={2} />
      </Screen>
    );
  }
  if (server.isError || !s) {
    // Unlisted Servers you aren't in (or deleted ones) are "not found" by design: explain instead of erroring.
    const missing = server.isError && toAppError(server.error).code === 'not_found';
    return (
      <Screen header={<AppHeader title="Server" />}>
        {missing ? (
          <EmptyState icon="lock-closed-outline" title="This Server isn't available"
            body="It may be invite-only or no longer exist. Scan its QR code or enter an invite code to join."
            action={{ label: 'Scan or enter a code', onPress: () => router.replace('/join') }} />
        ) : (
          <ErrorState error={server.error} onRetry={server.refetch} />
        )}
      </Screen>
    );
  }

  const ended = !s.is_live;
  const membership = s.membership;
  const pending = membership?.status === 'pending';
  const banned = membership?.status === 'banned';

  const onLeave = async () => {
    const ok = await confirm({
      title: `Leave ${s.name}?`,
      message: "You'll stop appearing here and lose access to its activity. You can rejoin later if the Server allows it.",
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    leave.mutate(id, {
      onSuccess: () => {
        toast.success(`You left ${s.name}`);
        router.back();
      },
      onError: (e) => {
        const code = toAppError(e).code;
        if (code === 'last_admin') toast.error('Make someone else an admin before leaving.');
        else if (code === 'banned') toast.error('You were removed from this Server.');
        else toast.error(e);
      },
    });
  };

  const onJoin = () =>
    request.mutate(id, {
      onSuccess: (r) => {
        if (r.status === 'active') toast.success(`You joined ${s.name}`);
        else if (r.status === 'pending') toast.success('Request sent. An admin will review it.');
        else toast.error('This Server is no longer available');
      },
      onError: toast.error,
    });

  const discover = () => {
    select(id);
    router.navigate('/discover');
  };

  const noteField = s.kind === 'long_term' && s.member_field_label ? s.member_field_label : null;
  const saveNote = () =>
    setProfile.mutate(
      // Profiles are one universal view; the RPC still takes a mode.
      { mode: 'both', note: (memberNote ?? membership?.member_note ?? '').trim() || null },
      { onSuccess: () => { setMemberNote(null); toast.success('Saved for this Server'); }, onError: toast.error },
    );
  // my_venue_session only returns a session that hasn't ended.
  const talk = venueSession.data ?? null;

  return (
    <>
    <Screen
      header={
        <AppHeader title={s.name} />
      }
      onRefresh={() => {
        server.refetch();
        if (member) announcements.refetch();
      }}
      refreshing={server.isRefetching}
      edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        {s.is_admin ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${s.name} Server picture`}
            onPress={() => router.push(`/server/${id}/settings`)}>
            <ServerAvatar name={s.name} category={s.category} avatarPath={s.avatar_path} size={72} />
          </Pressable>
        ) : (
          <ServerAvatar name={s.name} category={s.category} avatarPath={s.avatar_path} size={72} />
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="title" numberOfLines={2} style={{ flexShrink: 1 }}>
              {s.name}
            </Text>
            {s.is_official ? <Ionicons name="shield-checkmark" size={20} color={colors.primary} accessibilityLabel="Verified organisation" /> : null}
          </View>
          <Text variant="callout" color="textSecondary">
            {KIND_LABEL[s.kind]} · {CATEGORY_LABEL[s.category] ?? s.category}
            {s.city ? ` · ${s.city}` : ''}
          </Text>
        </View>
      </View>

      {s.can_manage ? <ServerManagementPanel server={s} /> : null}

      {s.parent ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Part of ${s.parent.name}. Open parent Server`}
          onPress={() => router.push(`/server/${s.parent!.id}`)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ServerAvatar name={s.parent.name} category="community" avatarPath={s.parent.avatar_path} size={26} />
          <Text variant="callout" style={{ color: colors.primary }}>
            Part of {s.parent.name}
          </Text>
        </Pressable>
      ) : null}

      {s.is_archived ? <Banner tone="warning" icon="archive-outline" body="This Server has been archived and is read-only." /> : null}
      {ended && !s.is_archived ? <Banner tone="warning" title="This event has ended" body="Joining and discovery are closed. Chats from it were removed unless both people saved the connection." /> : null}
      {pending ? <Banner tone="info" icon="time-outline" title="Awaiting approval" body="An admin will review your request. We'll notify you when they decide." /> : null}
      {banned ? <Banner tone="danger" title="You were removed from this Server" body="You can no longer see its members or appear in it." /> : null}

      {s.description ? (
        <Text variant="body" color="textSecondary">
          {s.description}
        </Text>
      ) : null}

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name={s.kind === 'short_term' ? 'time-outline' : 'business-outline'} size={18} color={colors.textSecondary} />
          <Text variant="callout">{KIND_LABEL[s.kind]} Server</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Ionicons name="sparkles-outline" size={18} color={colors.textSecondary} style={{ marginTop: 2 }} />
          <Text variant="callout" style={{ flex: 1 }}>
            Created {formatDateTime(s.created_at)}
            {s.creator ? ' by ' : ''}
            {s.creator ? (
              <Text variant="callout" style={{ color: colors.primary }} accessibilityRole="link"
                onPress={() => router.push(member
                  ? { pathname: '/user/[id]', params: { id: s.creator!.id, serverId: id, serverName: s.name } }
                  : { pathname: '/user/[id]', params: { id: s.creator!.id } })}>
                {s.creator.display_name}
              </Text>
            ) : null}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="people-outline" size={18} color={colors.textSecondary} />
          <Text variant="callout">
            {s.member_count} member{s.member_count === 1 ? '' : 's'}
          </Text>
        </View>
        {s.kind === 'short_term' && (s.starts_at || s.ends_at) ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              {s.starts_at ? <Text variant="callout">Starts {formatDateTime(s.starts_at)}</Text> : null}
              {s.ends_at ? (
                <Text variant="callout" color={ended ? 'warning' : 'text'}>
                  {ended ? 'Ended' : 'Ends'} {formatDateTime(s.ends_at)}
                  {!ended ? ` (${formatDistanceToNow(new Date(s.ends_at))} left)` : ''}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {s.available_now ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="radio" size={18} color={colors.accentStrong} />
            <Text variant="callout">{s.available_now} {s.available_now === '1' ? 'person' : 'people'} available now</Text>
          </View>
        ) : null}
        {s.ephemeral_chats ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Ionicons name="chatbubbles-outline" size={18} color={colors.textSecondary} />
            <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
              Chats disappear when this event ends unless you both save the connection.
            </Text>
          </View>
        ) : null}
        {membership ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Ionicons name="person-circle-outline" size={18} color={colors.textSecondary} />
            <TagList>
              <Tag
                small
                tone={membership.status === 'active' ? 'accent' : 'warning'}
                label={membership.status === 'active' ? 'Member' : membership.status === 'pending' ? 'Pending' : 'Removed'}
              />
              {membership.status === 'active' && membership.role !== 'member' ? (
                <Tag small tone="brand" label={membership.role === 'admin' ? 'Admin' : 'Moderator'} />
              ) : null}
            </TagList>
          </View>
        ) : null}
      </Card>

      {member && s.my_badges.length ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Your badges here" />
          <TagList>
            {s.my_badges.map((b) => (
              <VerifiedBadge key={b.id} label={b.label} official={s.is_official} serverName={s.name} />
            ))}
          </TagList>
        </View>
      ) : null}

      {/* Actions for non-members */}
      {!membership && !ended && !s.is_archived ? (
        <View style={{ gap: 10 }}>
          {s.join_policy === 'invite_only' ? (
            <Banner
              tone="info"
              icon="lock-closed-outline"
              title="Invite only"
              body="Scan this Server's QR code or enter its invite code to join."
              action={{ label: 'Scan or enter a code', onPress: () => router.push('/join') }}
            />
          ) : (
            <Button
              title={s.join_policy === 'open' ? 'Join Server' : 'Request to join'}
              icon="enter-outline"
              loading={request.isPending}
              onPress={onJoin}
            />
          )}
          {s.requires_parent_membership && s.parent ? (
            <Text variant="caption" color="textTertiary">
              Requires membership of {s.parent.name}.
            </Text>
          ) : null}
        </View>
      ) : null}

      {member ? (
        <View style={{ gap: 12 }}>
          <Button
            title={s.kind === 'short_term' ? (s.starts_at && new Date(s.starts_at).getTime() > now ? 'People attending' : 'People here') : 'Member directory'}
            variant="secondary"
            icon="people-outline"
            onPress={() => router.push(`/server/${id}/directory`)}
          />
          {noteField ? (
            <Card style={{ gap: 12 }}>
              <Text variant="subheading">Your member info</Text>
              <TextField label={`${noteField} (optional)`} placeholder={s.member_field_hint ?? undefined}
                hint="Only members of this Server see it, next to your name in the directory."
                value={memberNote ?? membership?.member_note ?? ''} onChangeText={setMemberNote} maxCount={100} />
              <Button title="Save" size="sm" variant="secondary" loading={setProfile.isPending}
                disabled={memberNote === null || memberNote.trim() === (membership?.member_note ?? '')} onPress={saveNote} />
            </Card>
          ) : null}
          {liveVenue ? (
            <Card tone={talk?.open_to_talk ? 'brand' : 'default'} onPress={() => router.push(`/server/${id}/presence`)}
              accessibilityLabel="Manage Open to Talk here" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name={talk?.open_to_talk ? 'chatbubbles' : 'chatbubbles-outline'} size={22} color={colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="subheading">
                  {talk?.open_to_talk ? `Open to Talk until ${formatClock(talk.ends_at)}` : 'Open to Talk here'}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {talk?.open_to_talk ? 'Change duration, topic or how to find you, or stop.' : talk ? `You're here until ${formatClock(talk.ends_at)}. Tap to be Open to Talk.` : 'Let people at this venue know you’re up for a chat.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Card>
          ) : null}
          {!ended && !s.is_archived ? (
            <>
              <Button title={s.kind === 'short_term' ? 'See people here on Home' : 'Discover people here'} icon="radio-outline" onPress={discover} />
              <Button
                title="Post in Activity"
                variant="secondary"
                icon="megaphone-outline"
                onPress={() => router.push({ pathname: '/post/compose', params: { serverId: id } })}
              />
            </>
          ) : null}
          <ListGroup>
            <SwitchRow
              icon="eye-outline"
              title="Visible in this Server"
              subtitle="When off, you're hidden here even while Available, and you can't browse people here either."
              value={membership?.discoverable ?? false}
              disabled={setDiscoverable.isPending}
              onValueChange={(v) => setDiscoverable.mutate(v, { onError: toast.error })}
            />
          </ListGroup>
        </View>
      ) : null}

      {member && !s.can_manage ? <RolesExplainer /> : null}

      {s.children.length ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Inside this Server" />
          <ListGroup>
            {s.children.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`${c.name}, ${c.member_count} members`}
                onPress={() => router.push(`/server/${c.id}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 16, minHeight: 56,
                  backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
                })}>
                <ServerAvatar name={c.name} category={c.category} avatarPath={c.avatar_path} size={40} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="callout" numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text variant="caption" color="textSecondary">
                    {c.member_count} member{c.member_count === 1 ? '' : 's'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Pressable>
            ))}
          </ListGroup>
          <Text variant="caption" color="textTertiary">
            Joining a sub-Server doesn&apos;t make you a member of this one, and the other way round.
          </Text>
        </View>
      ) : null}

      {member || s.can_manage ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Recent Server messages" />
          {announcements.isLoading ? (
            <LoadingList count={1} />
          ) : announcements.isError ? (
            <ErrorState compact error={announcements.error} onRetry={announcements.refetch} />
          ) : (announcements.data ?? []).length === 0 ? (
            <Text variant="callout" color="textSecondary">
              No Server messages yet.
            </Text>
          ) : (
            (announcements.data ?? []).slice(0, 3).map((a) => (
              <Card key={a.id} style={{ gap: 4 }}>
                <Text variant="callout" color="textSecondary">
                  {a.body}
                </Text>
                <Text variant="caption" color="textTertiary">
                  {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                </Text>
              </Card>
            ))
          )}
        </View>
      ) : null}

      {member ? (
        <Button title="Leave Server" variant="danger" icon="exit-outline" loading={leave.isPending} onPress={onLeave} />
      ) : null}
      {pending ? (
        <Button
          title="Cancel request"
          variant="secondary"
          loading={leave.isPending}
          onPress={() =>
            leave.mutate(id, {
              onSuccess: () => toast.info('Request cancelled'),
              onError: toast.error,
            })
          }
        />
      ) : null}
    </Screen>
    </>
  );
}
