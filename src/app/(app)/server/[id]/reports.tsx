import { formatDistanceToNow } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  AppHeader, Avatar, Banner, Button, Card, EmptyState, ErrorState, LoadingList, Screen, SegmentedControl, Tag, Text, TextField, confirm, toast,
} from '@/components/ui';
import { useBanMember, useReports, useReviewReport, useServer } from '@/features/servers/hooks';
import { useModerateRemovePost } from '@/features/social/hooks';
import { useTheme } from '@/theme';
import type { Report, ReportReason, ReportStatus } from '@/types/domain';

const REASON_LABEL: Record<ReportReason, string> = {
  spam: 'Spam', harassment: 'Harassment', inappropriate: 'Inappropriate content', fake_profile: 'Fake profile', safety: 'Safety concern',
  underage: 'Possibly underage', other: 'Other',
};

export default function ReportsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const server = useServer(id);
  if (server.isLoading) {
    return (
      <Screen header={<AppHeader title="Reports" />}>
        <LoadingList count={2} />
      </Screen>
    );
  }
  if (server.isError || !server.data) {
    return (
      <Screen header={<AppHeader title="Reports" />}>
        <ErrorState error={server.error} onRetry={server.refetch} />
      </Screen>
    );
  }
  if (!server.data.can_manage) {
    return (
      <Screen header={<AppHeader title="Reports" />}>
        <EmptyState icon="lock-closed-outline" title="Admins and moderators only" body="Reports are only visible to this Server's staff." />
      </Screen>
    );
  }

  return <Queue id={id} name={server.data.name} isAdmin={server.data.is_admin} />;
}

function Queue({ id, name, isAdmin }: { id: string; name: string; isAdmin: boolean }) {
  const { colors, radius } = useTheme();
  const [status, setStatus] = useState<ReportStatus>('open');
  const reports = useReports(id, status);
  const review = useReviewReport();
  const ban = useBanMember(id);
  const removePost = useModerateRemovePost();
  const [compose, setCompose] = useState<{ reportId: string; status: 'actioned' | 'dismissed' } | null>(null);
  const [note, setNote] = useState('');

  const setReportStatus = (r: Report, next: ReportStatus, n: string | null) =>
    review.mutate(
      { reportId: r.id, status: next, note: n },
      {
        onSuccess: () => {
          toast.success(next === 'reviewing' ? 'Marked as reviewing' : next === 'actioned' ? 'Marked as action taken' : 'Report dismissed');
          setCompose(null);
          setNote('');
        },
        onError: toast.error,
      },
    );

  const onBan = async (r: Report) => {
    if (!r.target) return;
    const ok = await confirm({
      title: `Ban ${r.target.display_name} from this Server?`,
      message: 'They are removed from this Server and cannot rejoin until an admin unbans them.',
      confirmLabel: 'Ban',
      destructive: true,
    });
    if (!ok) return;
    ban.mutate(
      { userId: r.target.id, reason: `Report: ${REASON_LABEL[r.reason]}` },
      { onSuccess: () => toast.success(`${r.target?.display_name} was banned`), onError: toast.error },
    );
  };

  const onRemovePost = async (r: Report) => {
    if (!r.target_post_id) return;
    const ok = await confirm({
      title: 'Remove this post?',
      message: 'The post is removed from Activity for everyone in this Server.',
      confirmLabel: 'Remove post',
      destructive: true,
    });
    if (!ok) return;
    removePost.mutate(
      { postId: r.target_post_id, reason: `Report: ${REASON_LABEL[r.reason]}` },
      { onSuccess: () => toast.success('Post removed'), onError: toast.error },
    );
  };

  const list = reports.data ?? [];
  const emptyBody: Record<ReportStatus, string> = {
    open: 'Nothing waiting for review. Nice and calm.',
    reviewing: 'Reports you are working on show up here.',
    actioned: 'Reports where you took action show up here.',
    dismissed: 'Dismissed reports show up here.',
  };

  return (
    <Screen
      header={<AppHeader title="Reports" subtitle={name} />}
      edges={['top', 'bottom']}
      onRefresh={() => reports.refetch()}
      refreshing={reports.isRefetching}>
      <SegmentedControl<ReportStatus>
        options={[
          { value: 'open', label: 'Open' }, { value: 'reviewing', label: 'Reviewing' },
          { value: 'actioned', label: 'Actioned' }, { value: 'dismissed', label: 'Dismissed' },
        ]}
        value={status}
        onChange={(s) => {
          setStatus(s);
          setCompose(null);
        }}
      />
      <Banner tone="info" icon="eye-off-outline" body="Reporter identity is intentionally hidden from Server staff to protect people who report." />
      {!isAdmin ? (
        <Text variant="caption" color="textSecondary">
          As a moderator you can review reports and remove posts. Only admins can ban or remove members.
        </Text>
      ) : null}

      {reports.isLoading ? (
        <LoadingList count={2} />
      ) : reports.isError ? (
        <ErrorState error={reports.error} onRetry={reports.refetch} />
      ) : list.length === 0 ? (
        <EmptyState icon="shield-checkmark-outline" title="No reports here" body={emptyBody[status]} />
      ) : (
        list.map((r) => {
          const composing = compose?.reportId === r.id ? compose : null;
          return (
            <Card key={r.id} style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Tag label={REASON_LABEL[r.reason]} tone="warning" small />
                <Text variant="caption" color="textTertiary">
                  {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                </Text>
              </View>

              {r.details ? <Text variant="callout">{r.details}</Text> : null}

              {r.content_snapshot ? (
                <View style={{ borderLeftWidth: 3, borderLeftColor: colors.borderStrong, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, padding: 10 }}>
                  <Text variant="micro" color="textTertiary">
                    REPORTED CONTENT
                  </Text>
                  <Text variant="callout" color="textSecondary">
                    &ldquo;{r.content_snapshot}&rdquo;
                  </Text>
                </View>
              ) : null}

              {r.target ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View profile of ${r.target.display_name}`}
                  onPress={() => router.push(`/user/${r.target!.id}`)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar path={r.target.avatar_path} name={r.target.display_name} size={32} />
                  <View>
                    <Text variant="callout">{r.target.display_name}</Text>
                    <Text variant="caption" color="textTertiary">
                      @{r.target.username}
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {r.resolution_note ? (
                <Text variant="caption" color="textSecondary">
                  Note: {r.resolution_note}
                </Text>
              ) : null}

              {status === 'open' || status === 'reviewing' ? (
                <View style={{ gap: 10 }}>
                  {composing ? (
                    <View style={{ gap: 10 }}>
                      <TextField
                        label={composing.status === 'actioned' ? 'What did you do? (optional)' : 'Why dismiss? (optional)'}
                        value={note}
                        onChangeText={setNote}
                        maxCount={500}
                        multiline
                      />
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <Button title="Cancel" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => setCompose(null)} />
                        <Button
                          title={composing.status === 'actioned' ? 'Mark action taken' : 'Dismiss'}
                          size="sm"
                          style={{ flex: 1 }}
                          loading={review.isPending}
                          onPress={() => setReportStatus(r, composing.status, note.trim() || null)}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      {status === 'open' ? (
                        <Button title="Reviewing" size="sm" variant="secondary" icon="eye-outline" loading={review.isPending && review.variables?.reportId === r.id} onPress={() => setReportStatus(r, 'reviewing', null)} />
                      ) : null}
                      <Button title="Action taken" size="sm" icon="checkmark" onPress={() => { setNote(''); setCompose({ reportId: r.id, status: 'actioned' }); }} />
                      <Button title="Dismiss" size="sm" variant="ghost" onPress={() => { setNote(''); setCompose({ reportId: r.id, status: 'dismissed' }); }} />
                    </View>
                  )}

                  {!composing && ((isAdmin && r.target) || r.target_post_id) ? (
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      {r.target_post_id ? (
                        <Button title="Remove post" size="sm" variant="danger" icon="trash-outline" loading={removePost.isPending} onPress={() => onRemovePost(r)} />
                      ) : null}
                      {r.target && isAdmin ? (
                        <Button title="Ban from this Server" size="sm" variant="danger" icon="ban-outline" loading={ban.isPending} onPress={() => onBan(r)} />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
