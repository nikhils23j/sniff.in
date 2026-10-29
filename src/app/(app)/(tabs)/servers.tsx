import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ServerCard } from '@/components/ServerCard';
import {
  Button, EmptyState, ErrorState, IconButton, LoadingList, Screen, SectionHeader, Tag, Text, TextField, toast,
} from '@/components/ui';
import { useMyServers, useRequestToJoin, useServerSearch } from '@/features/servers/hooks';
import { serversApi } from '@/features/servers/api';
import { findActiveLinkToken, serverInviteUrl } from '@/features/servers/invite-link';
import { qk } from '@/lib/query-client';
import { useTheme } from '@/theme';
import type { ServerSearchResult, ServerSummary } from '@/types/domain';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function ServersScreen() {
  const { colors } = useTheme();
  const mine = useMyServers();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 350);
  const search = useServerSearch(debounced);
  const request = useRequestToJoin();
  const qc = useQueryClient();
  const [showPast, setShowPast] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const copying = useRef(false);

  const { live, past } = useMemo(() => {
    const all = mine.data ?? [];
    return { live: all.filter((s) => s.is_live), past: all.filter((s) => !s.is_live) };
  }, [mine.data]);

  const act = (s: ServerSearchResult) =>
    request.mutate(s.id, {
      onSuccess: (r) => {
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        if (r.status === 'invalid') return toast.error('This Server is no longer available');
        if (r.status === 'active') {
          toast.success(`You joined ${s.name}`);
          router.push(`/server/${s.id}`);
        } else toast.success('Request sent. An admin will review it.');
      },
      onError: toast.error,
    });

  const copyInvite = async (s: ServerSummary) => {
    if (s.role !== 'admin' || s.status !== 'active') {
      toast.info('Only Server admins can copy invite links. Ask an admin to share one.');
      return;
    }
    if (!s.is_live) {
      toast.info('This Server has ended, so its invite links no longer work.');
      return;
    }
    if (copying.current) return;
    copying.current = true;
    setCopyingId(s.id);
    try {
      const tokens = await serversApi.listTokens(s.id);
      const active = findActiveLinkToken(tokens);
      const invite = active ?? await serversApi.createToken(s.id, 'link', 10080, null, 'Quick share');
      if (!active) qc.invalidateQueries({ queryKey: qk.serverTokens(s.id) });
      await Clipboard.setStringAsync(serverInviteUrl(invite.token));
      toast.success('Invite link copied');
    } catch (e) {
      toast.error(e);
    } finally {
      copying.current = false;
      setCopyingId(null);
    }
  };

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 }}>
      <Text variant="title" accessibilityRole="header">
        Servers
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Button title="Join" size="sm" variant="secondary" icon="qr-code-outline" onPress={() => router.push('/join')} />
        <Button title="Create" size="sm" icon="add" onPress={() => router.push('/server/new')} />
      </View>
    </View>
  );

  const searchRight = (s: ServerSearchResult) => {
    // Explore never contains Servers you already have a membership in (server-side filter).
    if (s.join_policy === 'invite_only') return <Tag label="Invite only" small icon="lock-closed-outline" />;
    const loading = request.isPending && request.variables === s.id;
    return (
      <Button
        title={s.join_policy === 'open' ? 'Join' : 'Request'}
        size="sm"
        loading={loading}
        disabled={request.isPending}
        onPress={() => act(s)}
        accessibilityLabel={`${s.join_policy === 'open' ? 'Join' : 'Request to join'} ${s.name}`}
      />
    );
  };

  return (
    <Screen
      header={header}
      onRefresh={() => {
        mine.refetch();
        search.refetch();
      }}
      refreshing={mine.isRefetching}>
      <View style={{ gap: 12 }}>
        <SectionHeader title="Your Servers" />
        {mine.isLoading ? (
          <LoadingList count={2} />
        ) : mine.isError ? (
          <ErrorState error={mine.error} onRetry={mine.refetch} compact />
        ) : (mine.data ?? []).length === 0 ? (
          <EmptyState
            icon="qr-code"
            title="You're not in any Server yet"
            body="Servers are the places you're part of: your campus, office, building or tonight's event. Scan a QR code at the venue, enter an invite code, or explore public Servers below."
            action={{ label: 'Scan a QR code', icon: 'qr-code', onPress: () => router.push('/join') }}
          />
        ) : (
          <>
            {live.map((s) => (
              <ServerCard
                key={s.id}
                name={s.name} category={s.category} kind={s.kind} avatarPath={s.avatar_path} parentName={s.parent_name} memberCount={s.member_count}
                isOfficial={s.is_official} endsAt={s.ends_at} availableNow={s.available_now} status={s.status} role={s.role}
                isLive={s.is_live} onPress={() => router.push(`/server/${s.id}`)}
                onInvitePress={() => copyInvite(s)} inviteBusy={copyingId === s.id}
                onSettingsPress={() => router.push(`/server/${s.id}/settings`)}
              />
            ))}
            {live.length === 0 ? (
              <Text variant="callout" color="textSecondary">
                No live Servers right now. Your past events are below.
              </Text>
            ) : null}
            {past.length > 0 ? (
              <View style={{ gap: 12 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Past events, ${past.length}. ${showPast ? 'Collapse' : 'Expand'}`}
                  accessibilityState={{ expanded: showPast }}
                  onPress={() => setShowPast((v) => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
                  <Ionicons name={showPast ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textSecondary} />
                  <Text variant="callout" color="textSecondary">
                    Past events ({past.length})
                  </Text>
                </Pressable>
                {showPast
                  ? past.map((s) => (
                      <ServerCard
                        key={s.id}
                        name={s.name} category={s.category} kind={s.kind} avatarPath={s.avatar_path} parentName={s.parent_name} memberCount={s.member_count}
                        isOfficial={s.is_official} endsAt={s.ends_at} status={s.status} role={s.role}
                        isLive={false} onPress={() => router.push(`/server/${s.id}`)}
                        onInvitePress={() => copyInvite(s)} inviteBusy={copyingId === s.id}
                        onSettingsPress={() => router.push(`/server/${s.id}/settings`)}
                      />
                    ))
                  : null}
              </View>
            ) : null}
          </>
        )}
      </View>

      <View style={{ gap: 12 }}>
        <SectionHeader title="Explore Servers" />
        <TextField
          placeholder="Search public Servers or a city"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search Servers"
          right={
            query ? (
              <IconButton icon="close-circle" label="Clear search" size={32} onPress={() => setQuery('')} />
            ) : (
              <Ionicons name="search" size={18} color={colors.textTertiary} />
            )
          }
        />
        {search.isLoading ? (
          <LoadingList count={2} />
        ) : search.isError ? (
          <ErrorState error={search.error} onRetry={search.refetch} compact />
        ) : (search.data ?? []).length === 0 ? (
          <EmptyState
            compact
            icon="search"
            title={debounced ? 'No Servers match' : 'No public Servers yet'}
            body={debounced ? 'Try a different name or city. Private Servers are only reachable through their QR code or invite.' : 'Public Servers appear here when their admins list them.'}
          />
        ) : (
          (search.data ?? []).map((s) => (
            <ServerCard
              key={s.id}
              name={s.name} category={s.category} kind={s.kind} avatarPath={s.avatar_path} parentName={s.parent_name} memberCount={s.member_count}
              isOfficial={s.is_official} endsAt={s.ends_at} onPress={() => router.push(`/server/${s.id}`)}
              right={searchRight(s)}
            />
          ))
        )}
      </View>
    </Screen>
  );
}
