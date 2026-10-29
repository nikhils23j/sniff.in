import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { AppHeader, Banner, Card, EmptyState, ErrorState, LoadingList, Screen, Text } from '@/components/ui';
import { useAuditLog, useServer } from '@/features/servers/hooks';
import { useTheme } from '@/theme';
import type { AuditEntry } from '@/types/domain';

const ACTIONS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  server_created: { label: 'Server created', icon: 'add-circle-outline' },
  server_archived: { label: 'Server archived', icon: 'archive-outline' },
  server_verified: { label: 'Marked as official', icon: 'shield-checkmark-outline' },
  server_unverified: { label: 'Official status removed', icon: 'shield-outline' },
  join_token_created: { label: 'Invite created', icon: 'qr-code-outline' },
  join_token_revoked: { label: 'Invite revoked', icon: 'ban-outline' },
  membership_approved: { label: 'Join request approved', icon: 'checkmark-circle-outline' },
  membership_rejected: { label: 'Join request declined', icon: 'close-circle-outline' },
  role_changed: { label: 'Role changed', icon: 'swap-horizontal-outline' },
  member_banned: { label: 'Member banned', icon: 'ban-outline' },
  member_unbanned: { label: 'Member unbanned', icon: 'refresh-circle-outline' },
  member_removed: { label: 'Member removed', icon: 'person-remove-outline' },
  badge_granted: { label: 'Badge granted', icon: 'ribbon-outline' },
  badge_revoked: { label: 'Badge revoked', icon: 'ribbon-outline' },
  post_removed: { label: 'Post removed', icon: 'trash-outline' },
  report_open: { label: 'Report reopened', icon: 'flag-outline' },
  report_reviewing: { label: 'Report under review', icon: 'eye-outline' },
  report_actioned: { label: 'Report actioned', icon: 'flag' },
  report_dismissed: { label: 'Report dismissed', icon: 'flag-outline' },
  announcement_posted: { label: 'Announcement posted', icon: 'megaphone-outline' },
};

function humanise(action: string) {
  const known = ACTIONS[action];
  if (known) return known;
  const text = action.replace(/_/g, ' ');
  return { label: text.charAt(0).toUpperCase() + text.slice(1), icon: 'document-text-outline' as const };
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Short, safe summary of the structured details (no ids, no free-form blobs). */
function detailLine(e: AuditEntry): string | null {
  const d = e.details ?? {};
  const bits: string[] = [];
  if (e.action === 'role_changed' && (str(d.from) || str(d.to))) bits.push(`${str(d.from) ?? '?'} to ${str(d.to) ?? '?'}`);
  if (e.action === 'join_token_created' && str(d.kind)) bits.push(`${str(d.kind)} invite`);
  if (str(d.label)) bits.push(`"${str(d.label)}"`);
  if (str(d.reason)) bits.push(`Reason: ${str(d.reason)}`);
  if (str(d.note)) bits.push(`Note: ${str(d.note)}`);
  return bits.length ? bits.join(' · ') : null;
}

export default function AuditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const server = useServer(id);
  const canManage = server.data?.can_manage === true;
  const log = useAuditLog(canManage ? id : '');

  if (server.isLoading) {
    return (
      <Screen header={<AppHeader title="Audit log" />}>
        <LoadingList count={3} />
      </Screen>
    );
  }
  if (server.isError || !server.data) {
    return (
      <Screen header={<AppHeader title="Audit log" />}>
        <ErrorState error={server.error} onRetry={server.refetch} />
      </Screen>
    );
  }
  if (!canManage) {
    return (
      <Screen header={<AppHeader title="Audit log" />}>
        <EmptyState icon="lock-closed-outline" title="Admins and moderators only" body="The audit log is only visible to this Server's staff." />
      </Screen>
    );
  }

  const list = log.data ?? [];

  return (
    <Screen
      header={<AppHeader title="Audit log" subtitle={server.data.name} />}
      edges={['top', 'bottom']}
      onRefresh={() => log.refetch()}
      refreshing={log.isRefetching}>
      <Banner tone="info" icon="document-text-outline" body="Administrative actions in this Server, newest first. Showing the latest 100 entries." />
      {log.isLoading ? (
        <LoadingList count={4} />
      ) : log.isError ? (
        <ErrorState error={log.error} onRetry={log.refetch} />
      ) : list.length === 0 ? (
        <EmptyState icon="document-text-outline" title="No activity yet" body="Admin and moderator actions will be recorded here." />
      ) : (
        list.map((e) => {
          const a = humanise(e.action);
          const extra = detailLine(e);
          return (
            <Card key={e.id} style={{ flexDirection: 'row', gap: 12 }} accessibilityLabel={`${a.label}, ${format(new Date(e.created_at), 'd MMM, h:mm a')}`}>
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={a.icon} size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="subheading">{a.label}</Text>
                <Text variant="caption" color="textSecondary">
                  {e.actor ? `By ${e.actor.display_name} (@${e.actor.username})` : 'By the system'}
                  {e.target ? ` · ${e.target.display_name} (@${e.target.username})` : ''}
                </Text>
                {extra ? (
                  <Text variant="caption" color="textSecondary">
                    {extra}
                  </Text>
                ) : null}
                <Text variant="caption" color="textTertiary">
                  {format(new Date(e.created_at), 'd MMM yyyy, h:mm a')}
                </Text>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
