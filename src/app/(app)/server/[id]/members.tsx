import Ionicons from '@expo/vector-icons/Ionicons';
import { addDays, addYears, formatDistanceToNow } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader, Avatar, Banner, Button, Card, EmptyState, ErrorState, ListGroup, ListRow, LoadingList, Screen, SegmentedControl, Tag, TagList,
  Text, TextField, VerifiedBadge, confirm, toast,
} from '@/components/ui';
import { useUserId } from '@/features/auth/session-store';
import {
  useBanMember, useGrantBadge, useRemoveMember, useReviewMembership, useRevokeBadge, useServer, useServerMembers, useSetRole, useUnbanMember,
} from '@/features/servers/hooks';
import { BADGE_KINDS } from '@/features/servers/presets';
import { toAppError } from '@/lib/errors';
import { useTheme } from '@/theme';
import type { BadgeKind, MemberRole, MemberStatus, ServerMember } from '@/types/domain';

const ROLE_LABEL: Record<MemberRole, string> = { member: 'Member', moderator: 'Moderator', admin: 'Admin' };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ------------------------------------------------------------------ member action sheet
type SheetView = 'menu' | 'grant' | 'revoke' | 'ban';

function MemberSheet({
  serverId, serverName, member, isAdmin, isPermanent, isSelf, myId, onClose,
}: {
  serverId: string; serverName: string; member: ServerMember | null; isAdmin: boolean; isPermanent: boolean; isSelf: boolean;
  myId: string | null; onClose: () => void;
}) {
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<SheetView>('menu');
  const [kind, setKind] = useState<BadgeKind>('member');
  const [label, setLabel] = useState('Verified Member');
  const [expiry, setExpiry] = useState<'none' | '30d' | '1y'>('none');
  const [reason, setReason] = useState('');
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const setRole = useSetRole(serverId);
  const remove = useRemoveMember(serverId);
  const ban = useBanMember(serverId);
  const grant = useGrantBadge(serverId);
  const revoke = useRevokeBadge(serverId);

  useEffect(() => {
    if (member) {
      setView('menu');
      setKind('member');
      setLabel('Verified Member');
      setExpiry('none');
      setReason('');
      setRevokeId(null);
    }
  }, [member?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!member) return null;
  const name = member.display_name;
  const done = (msg: string) => {
    toast.success(msg);
    onClose();
  };

  const changeRole = async (role: MemberRole) => {
    const ok = await confirm({
      title: `Make ${name} ${role === 'member' ? 'a regular member' : `a${role === 'admin' ? 'n' : ''} ${role}`}?`,
      message: role === 'admin' ? 'Admins can manage members, invites, badges and settings.' : undefined,
      confirmLabel: 'Change role',
    });
    if (!ok) return;
    setRole.mutate({ userId: member.user_id, role }, { onSuccess: () => done(`${name} is now ${ROLE_LABEL[role].toLowerCase()}`), onError: toast.error });
  };

  const onRemove = async () => {
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: 'They lose access to this Server. They can rejoin with a valid invite.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(member.user_id, { onSuccess: () => done(`${name} was removed`), onError: toast.error });
  };

  const submitBan = async () => {
    const ok = await confirm({
      title: `Ban ${name}?`,
      message: 'They are removed and cannot rejoin this Server until an admin unbans them.',
      confirmLabel: 'Ban',
      destructive: true,
    });
    if (!ok) return;
    ban.mutate({ userId: member.user_id, reason: reason.trim() || null }, { onSuccess: () => done(`${name} was banned`), onError: toast.error });
  };

  const submitGrant = () => {
    const trimmed = label.trim();
    if (!trimmed) return toast.error('Enter a badge label');
    const expiresAt = expiry === '30d' ? addDays(new Date(), 30) : expiry === '1y' ? addYears(new Date(), 1) : null;
    grant.mutate(
      { userId: member.user_id, kind, label: trimmed, expiresAt: expiresAt ? expiresAt.toISOString() : null },
      {
        onSuccess: () => done('Badge granted'),
        onError: (e) => toast.error(toAppError(e).code === 'badge_exists' ? 'This member already has that badge.' : e),
      },
    );
  };

  const submitRevoke = () => {
    if (!revokeId) return;
    revoke.mutate({ badgeId: revokeId, reason: reason.trim() || null }, { onSuccess: () => done('Badge revoked'), onError: toast.error });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} />
        <View
          style={{
            backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '85%',
            paddingBottom: Math.max(insets.bottom, 16),
          }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar path={member.avatar_path} name={name} size={48} />
              <View style={{ flex: 1 }}>
                <Text variant="heading" numberOfLines={1}>
                  {name}
                </Text>
                <Text variant="caption" color="textTertiary">
                  @{member.username} · {ROLE_LABEL[member.role]}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            {view === 'menu' ? (
              <>
                <ListGroup>
                  <ListRow
                    icon="person-outline"
                    title="View profile"
                    onPress={() => {
                      onClose();
                      router.push({ pathname: '/user/[id]', params: { id: member.user_id, serverId, serverName } });
                    }}
                  />
                </ListGroup>

                {!isSelf ? (
                  <>
                    {isPermanent ? (
                      <View style={{ gap: 8 }}>
                        <Text variant="micro" color="textTertiary">
                          BADGES
                        </Text>
                        {member.badges.length ? (
                          <View style={{ gap: 8 }}>
                            {member.badges.map((b) => (
                              <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <VerifiedBadge label={b.label} compact />
                                {isAdmin || (!!myId && b.issued_by === myId) ? <Button
                                  title="Revoke"
                                  size="sm"
                                  variant="danger"
                                  onPress={() => {
                                    setRevokeId(b.id);
                                    setReason('');
                                    setView('revoke');
                                  }}
                                /> : null}
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text variant="callout" color="textSecondary">
                            No badges from this Server yet.
                          </Text>
                        )}
                        <Button title="Grant a badge" variant="secondary" icon="ribbon-outline" onPress={() => setView('grant')} />
                        {!isAdmin ? (
                          <Text variant="caption" color="textTertiary">
                            Moderators can revoke only the badges they issued.
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    {isAdmin ? (
                      <View style={{ gap: 8 }}>
                        <Text variant="micro" color="textTertiary">
                          ROLE
                        </Text>
                        <TagList>
                          {(['member', 'moderator', 'admin'] as MemberRole[]).map((r) => (
                            <Tag
                              key={r}
                              label={r === 'member' ? 'Make member' : r === 'moderator' ? 'Make moderator' : 'Make admin'}
                              selected={member.role === r}
                              onPress={member.role === r || setRole.isPending ? undefined : () => changeRole(r)}
                            />
                          ))}
                        </TagList>
                      </View>
                    ) : null}

                    {isAdmin ? <View style={{ gap: 8 }}>
                      <Button title="Remove from Server" variant="secondary" icon="person-remove-outline" loading={remove.isPending} onPress={onRemove} />
                      <Button title="Ban…" variant="danger" icon="ban-outline" onPress={() => { setReason(''); setView('ban'); }} />
                    </View> : null}
                  </>
                ) : (
                  <Text variant="caption" color="textTertiary">
                    This is you. You can manage your own membership from the Server page.
                  </Text>
                )}
              </>
            ) : null}

            {view === 'grant' ? (
              <View style={{ gap: 12 }}>
                <Text variant="subheading">Grant a badge</Text>
                <Text variant="caption" color="textSecondary">
                  Badges are issued by this Server and shown on their profile with this Server&apos;s name. They never carry over to other Servers.
                </Text>
                <TagList>
                  {BADGE_KINDS.filter((b) => isAdmin || ['custom','member','attendee','organizer'].includes(b.kind)).map((b) => (
                    <Tag
                      key={b.kind}
                      label={b.label}
                      selected={kind === b.kind}
                      onPress={() => {
                        setKind(b.kind);
                        setLabel(b.defaultLabel);
                      }}
                    />
                  ))}
                </TagList>
                <TextField label="Badge label" value={label} onChangeText={setLabel} maxCount={40} placeholder="Verified Resident" />
                <Text variant="caption" color="textSecondary">
                  Expires
                </Text>
                <TagList>
                  {([['none', 'Never'], ['30d', '30 days'], ['1y', '1 year']] as const).map(([v, l]) => (
                    <Tag key={v} label={l} selected={expiry === v} onPress={() => setExpiry(v)} />
                  ))}
                </TagList>
                <Button title="Grant badge" icon="ribbon" loading={grant.isPending} onPress={submitGrant} />
                <Button title="Back" variant="ghost" onPress={() => setView('menu')} />
              </View>
            ) : null}

            {view === 'revoke' ? (
              <View style={{ gap: 12 }}>
                <Text variant="subheading">Revoke badge</Text>
                <TextField label="Reason (optional)" value={reason} onChangeText={setReason} maxCount={200} placeholder="Left the company, no longer a resident…" />
                <Button title="Revoke badge" variant="danger" loading={revoke.isPending} onPress={submitRevoke} />
                <Button title="Back" variant="ghost" onPress={() => setView('menu')} />
              </View>
            ) : null}

            {view === 'ban' ? (
              <View style={{ gap: 12 }}>
                <Text variant="subheading">Ban {name}</Text>
                <Text variant="caption" color="textSecondary">
                  They can&apos;t rejoin this Server. The reason is stored in the audit log and visible to admins.
                </Text>
                <TextField label="Reason" value={reason} onChangeText={setReason} maxCount={200} placeholder="Harassing other members…" multiline />
                <Button title="Ban from Server" variant="danger" icon="ban" loading={ban.isPending} onPress={submitBan} />
                <Button title="Back" variant="ghost" onPress={() => setView('menu')} />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ------------------------------------------------------------------ screen
export default function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const server = useServer(id);
  const canManage = server.data?.can_manage === true;
  const isAdmin = server.data?.is_admin === true;
  const myId = useUserId();

  const [status, setStatus] = useState<MemberStatus>('active');
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const members = useServerMembers(canManage ? id : '', status, debounced);
  const review = useReviewMembership(id);
  const unban = useUnbanMember(id);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const list = members.data?.pages.flat() ?? [];
  const selected = list.find((m) => m.user_id === selectedUser) ?? null;

  if (server.isLoading) {
    return (
      <Screen header={<AppHeader title="Members" />}>
        <LoadingList count={3} />
      </Screen>
    );
  }
  if (server.isError || !server.data) {
    return (
      <Screen header={<AppHeader title="Members" />}>
        <ErrorState error={server.error} onRetry={server.refetch} />
      </Screen>
    );
  }
  if (!canManage) {
    return (
      <Screen header={<AppHeader title="Members" />}>
        <EmptyState icon="lock-closed-outline" title="Admins and moderators only" body="The member list is only visible to this Server's staff." />
      </Screen>
    );
  }

  const decide = (m: ServerMember, approve: boolean) =>
    review.mutate(
      { userId: m.user_id, approve },
      { onSuccess: () => toast.success(approve ? `${m.display_name} approved` : `${m.display_name} declined`), onError: toast.error },
    );

  const doUnban = async (m: ServerMember) => {
    const ok = await confirm({ title: `Unban ${m.display_name}?`, message: 'They will be able to rejoin with a valid invite.', confirmLabel: 'Unban' });
    if (!ok) return;
    unban.mutate(m.user_id, { onSuccess: () => toast.success(`${m.display_name} was unbanned`), onError: toast.error });
  };

  const emptyText: Record<MemberStatus, { title: string; body: string }> = {
    active: { title: debounced ? 'No members match' : 'No members yet', body: debounced ? 'Try a different name.' : 'Share an invite so people can join.' },
    pending: { title: 'No pending requests', body: 'Requests to join will show up here for review.' },
    banned: { title: 'No banned members', body: 'People you ban from this Server will be listed here.' },
  };

  return (
    <Screen
      header={<AppHeader title="Members" subtitle={server.data.name} />}
      edges={['top', 'bottom']}
      onRefresh={() => members.refetch()}
      refreshing={members.isRefetching}>
      <SegmentedControl<MemberStatus>
        options={isAdmin ? [{ value: 'active', label: 'Active' }, { value: 'pending', label: 'Pending' }, { value: 'banned', label: 'Banned' }] : [{ value: 'active', label: 'Active' }]}
        value={status}
        onChange={setStatus}
      />
      <TextField
        placeholder="Search by name or @username"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search members"
        right={<Ionicons name="search" size={18} color={colors.textTertiary} />}
      />
      <Banner tone="info" body={isAdmin ? "Admins manage membership and roles. Moderators can assign badges in permanent Servers but cannot add, remove or ban members." : "Moderators can assign badges in permanent Servers and review reports. Only admins can add, remove or ban members."} />

      {members.isLoading ? (
        <LoadingList count={3} />
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={members.refetch} />
      ) : list.length === 0 ? (
        <EmptyState icon="people-outline" title={emptyText[status].title} body={emptyText[status].body} />
      ) : (
        list.map((m) => {
          const tappable = status === 'active';
          return (
            <Card
              key={m.user_id}
              onPress={tappable ? () => setSelectedUser(m.user_id) : undefined}
              accessibilityLabel={`${m.display_name}, ${ROLE_LABEL[m.role]}`}
              style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar path={m.avatar_path} name={m.display_name} size={44} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="subheading" numberOfLines={1}>
                    {m.display_name}
                  </Text>
                  <Text variant="caption" color="textTertiary" numberOfLines={1}>
                    @{m.username} · {status === 'pending' ? 'requested' : status === 'banned' ? 'banned' : 'joined'}{' '}
                    {formatDistanceToNow(new Date(m.joined_at), { addSuffix: true })}
                  </Text>
                </View>
                {m.role !== 'member' && status === 'active' ? <Tag label={ROLE_LABEL[m.role]} tone="brand" small /> : null}
                {tappable ? <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} /> : null}
              </View>
              {m.badges.length ? (
                <TagList>
                  {m.badges.map((b) => (
                    <VerifiedBadge key={b.id} label={b.label} compact />
                  ))}
                </TagList>
              ) : null}
              {status === 'banned' && m.ban_reason ? (
                <Text variant="callout" color="textSecondary">
                  Reason: {m.ban_reason}
                </Text>
              ) : null}
              {status === 'pending' && isAdmin ? (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button title="Reject" variant="secondary" size="sm" style={{ flex: 1 }} disabled={review.isPending} onPress={() => decide(m, false)} />
                  <Button title="Approve" size="sm" style={{ flex: 1 }} loading={review.isPending && review.variables?.userId === m.user_id} disabled={review.isPending} onPress={() => decide(m, true)} />
                </View>
              ) : null}
              {status === 'banned' ? (
                isAdmin ? (
                  <Button title="Unban" variant="secondary" size="sm" disabled={unban.isPending} onPress={() => doUnban(m)} />
                ) : (
                  <Text variant="caption" color="textTertiary">
                    Only admins can unban.
                  </Text>
                )
              ) : null}
            </Card>
          );
        })
      )}
      {members.hasNextPage ? (
        <Button title="Load more" variant="secondary" loading={members.isFetchingNextPage} onPress={() => members.fetchNextPage()} />
      ) : null}

      <MemberSheet
        serverId={id}
        serverName={server.data.name}
        myId={myId ?? null}
        member={selected}
        isAdmin={isAdmin}
        isPermanent={server.data.kind === 'long_term'}
        isSelf={!!selected && selected.user_id === myId}
        onClose={() => setSelectedUser(null)}
      />
    </Screen>
  );
}
