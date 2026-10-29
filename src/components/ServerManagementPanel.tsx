import { format } from 'date-fns';
import { router } from 'expo-router';
import { View } from 'react-native';

import { RolesExplainer } from '@/components/ServerRoles';
import { Banner, Card, CountBadge, ErrorState, ListGroup, ListRow, LoadingList, SectionHeader, SwitchRow, Text, confirm, toast } from '@/components/ui';
import { useIsPlatformAdmin } from '@/features/profile/hooks';
import { useArchiveServer, useServerStats, useSetOfficial } from '@/features/servers/hooks';
import { useTheme } from '@/theme';
import type { ServerDetail } from '@/types/domain';

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  const { colors, radius } = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`}
      style={{ width: '48%', backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: 12, gap: 2 }}>
      <Text variant="title">{value}</Text>
      <Text variant="caption" color="textSecondary">{label}</Text>
      {hint ? <Text variant="micro" color="textTertiary">{hint}</Text> : null}
    </View>
  );
}

/** Management lives on the Server info page reached from the chat header. */
export function ServerManagementPanel({ server }: { server: ServerDetail }) {
  const id = server.id;
  const stats = useServerStats(id);
  const archive = useArchiveServer(id);
  const setOfficial = useSetOfficial(id);
  const isPlatformAdmin = useIsPlatformAdmin().data === true;
  const admin = server.is_admin;
  const data = stats.data;

  const onArchive = async () => {
    const ok = await confirm({
      title: `Archive ${server.name}?`,
      message: 'Archiving closes the Server: nobody can join, discover people here or use its invites. This cannot be undone from the app.',
      confirmLabel: 'Archive',
      destructive: true,
    });
    if (!ok) return;
    archive.mutate(undefined, {
      onSuccess: () => {
        toast.success('Server archived');
        router.dismissTo('/(tabs)/servers');
      },
      onError: toast.error,
    });
  };

  return (
    <View style={{ gap: 14 }}>
      <SectionHeader title="Server settings" />
      <ListGroup>
        {admin ? (
          <>
            <ListRow icon="camera-outline" title="Edit Server picture" subtitle="Take, crop, replace or remove this Server's picture"
              onPress={() => router.push(`/server/${id}/settings`)} />
            <ListRow icon="create-outline" title="Edit Server details" subtitle="Name, description, joining, schedule and venue"
              onPress={() => router.push(`/server/${id}/settings`)} />
            <ListRow icon="qr-code-outline" title="Invites & QR" subtitle="Create and revoke QR codes, links and codes"
              onPress={() => router.push(`/server/${id}/invites`)} />
          </>
        ) : null}
        <ListRow icon="people-outline" title="Members"
          subtitle={admin ? 'Membership, roles and badges' : 'View members and badges'}
          right={admin ? <CountBadge count={data?.pending_members ?? 0} /> : undefined}
          onPress={() => router.push(`/server/${id}/members`)} />
        <ListRow icon="flag-outline" title="Reports" subtitle="Moderation queue for this Server"
          right={<CountBadge count={data?.open_reports ?? 0} />}
          onPress={() => router.push(`/server/${id}/reports`)} />
        <ListRow icon="document-text-outline" title="Audit log" subtitle="Who did what, and when"
          onPress={() => router.push(`/server/${id}/audit`)} />
        {admin ? <ListRow icon="git-branch-outline" title="Create sub-Server" subtitle="A hall, team or room inside this Server"
          onPress={() => router.push({ pathname: '/server/new', params: { parentId: id } })} /> : null}
      </ListGroup>

      {!admin ? <Text variant="caption" color="textSecondary">You&apos;re a moderator here. Admins handle invites, membership settings and the Server&apos;s lifecycle.</Text> : null}
      <RolesExplainer />

      <SectionHeader title="Server activity" />
      {stats.isLoading ? <LoadingList count={1} /> : stats.isError || !data ? (
        <ErrorState compact error={stats.error} onRetry={stats.refetch} />
      ) : (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
            <Stat label="Active members" value={data.active_members} />
            <Stat label="Pending requests" value={data.pending_members} />
            <Stat label="Available now" value={data.available_now} hint="Active in the last 15 minutes" />
            <Stat label="Joined, last 7 days" value={data.joined_last_7d} />
            <Stat label="Posts, last 7 days" value={data.posts_last_7d} />
            <Stat label="Connections, last 7 days" value={data.connections_last_7d} />
            <Stat label="Open reports" value={data.open_reports} />
            <Stat label="Active badges" value={data.active_badges} />
          </View>
          <Text variant="caption" color="textTertiary">
            Aggregate counts only. Individual availability and location are never shown. Updated {format(new Date(data.computed_at), 'h:mm a')}.
          </Text>
        </Card>
      )}

      {isPlatformAdmin ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Platform admin" />
          <ListGroup>
            <SwitchRow icon="shield-checkmark-outline" title="Mark as official organisation"
              subtitle="Shows the verified shield on this Server and its badges."
              value={server.is_official} disabled={setOfficial.isPending}
              onValueChange={(value) => setOfficial.mutate(value, {
                onSuccess: () => toast.success(value ? 'Marked as official' : 'No longer official'),
                onError: toast.error,
              })} />
          </ListGroup>
        </View>
      ) : null}

      {admin && !server.is_archived ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Danger zone" />
          <ListGroup>
            <ListRow icon="archive-outline" title="Archive Server" subtitle="Closes joining and discovery"
              tone="danger" onPress={onArchive} disabled={archive.isPending} />
          </ListGroup>
        </View>
      ) : null}
      {server.is_archived ? <Banner tone="warning" icon="archive-outline" body="This Server is archived." /> : null}
    </View>
  );
}
