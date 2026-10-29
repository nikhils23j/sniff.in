import { formatDistanceToNow } from 'date-fns';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  AppHeader, Avatar, Banner, Button, Card, EmptyState, ErrorState, LoadingList, Screen, SegmentedControl, Tag, Text, TextField, confirm, toast,
} from '@/components/ui';
import { useIsPlatformAdmin } from '@/features/profile/hooks';
import { useReports, useReviewReport } from '@/features/servers/hooks';
import { useSetAccountStatus } from '@/features/social/hooks';
import { useTheme } from '@/theme';
import type { MiniCard, Report, ReportReason, ReportStatus } from '@/types/domain';

const REASON_LABEL: Record<ReportReason, string> = {
  spam: 'Spam', harassment: 'Harassment', inappropriate: 'Inappropriate content', fake_profile: 'Fake profile', safety: 'Safety concern',
  underage: 'Possibly underage', other: 'Other',
};

type Action = 'actioned' | 'dismissed' | 'suspend' | 'reinstate';

export default function AdminScreen() {
  const isAdmin = useIsPlatformAdmin();
  const header = <AppHeader title="Platform moderation" />;
  if (isAdmin.isLoading) {
    return (
      <Screen header={header}>
        <LoadingList count={2} />
      </Screen>
    );
  }
  if (isAdmin.isError) {
    return (
      <Screen header={header}>
        <ErrorState error={isAdmin.error} onRetry={() => { isAdmin.refetch(); }} />
      </Screen>
    );
  }
  if (!isAdmin.data) {
    return (
      <Screen header={header}>
        <EmptyState icon="lock-closed-outline" title="Not allowed" body="Platform moderation is only available to Sniff.in administrators." />
      </Screen>
    );
  }
  return <Queue header={header} />;
}

function Mini({ label, person }: { label: string; person: MiniCard }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${person.display_name}. View profile`}
      onPress={() => router.push(`/user/${person.id}`)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}>
      <Avatar path={person.avatar_path} name={person.display_name} size={32} />
      <View style={{ flex: 1 }}>
        <Text variant="micro" color="textTertiary">
          {label.toUpperCase()}
        </Text>
        <Text variant="callout" numberOfLines={1}>
          {person.display_name} <Text variant="caption" color="textTertiary">@{person.username}</Text>
        </Text>
      </View>
    </Pressable>
  );
}

function Queue({ header }: { header: React.ReactNode }) {
  const { colors, radius } = useTheme();
  const [status, setStatus] = useState<ReportStatus>('open');
  const reports = useReports(null, status);
  const review = useReviewReport();
  const account = useSetAccountStatus();
  const [compose, setCompose] = useState<{ reportId: string; action: Action } | null>(null);
  const [note, setNote] = useState('');

  const reset = () => {
    setCompose(null);
    setNote('');
  };

  const setReportStatus = (r: Report, next: ReportStatus, n: string | null) =>
    review.mutate(
      { reportId: r.id, status: next, note: n },
      {
        onSuccess: () => {
          toast.success(next === 'reviewing' ? 'Marked as reviewing' : next === 'actioned' ? 'Marked as action taken' : 'Report dismissed');
          reset();
        },
        onError: toast.error,
      },
    );

  const changeAccount = async (r: Report, next: 'suspended' | 'active') => {
    if (!r.target) return;
    const name = r.target.display_name;
    const ok = await confirm({
      title: next === 'suspended' ? `Suspend ${name}?` : `Reinstate ${name}?`,
      message:
        next === 'suspended'
          ? 'Suspension hides them from discovery everywhere, switches them to Do Not Disturb and blocks their actions until reinstated. This is recorded in the audit log.'
          : 'They can use Sniff.in again and appear in discovery. This is recorded in the audit log.',
      confirmLabel: next === 'suspended' ? 'Suspend' : 'Reinstate',
      destructive: next === 'suspended',
    });
    if (!ok) return;
    account.mutate(
      { userId: r.target.id, status: next, reason: note.trim() || null },
      {
        onSuccess: () => {
          toast.success(next === 'suspended' ? `${name} was suspended` : `${name} was reinstated`);
          reset();
        },
        onError: toast.error,
      },
    );
  };

  const list = reports.data ?? [];
  const emptyBody: Record<ReportStatus, string> = {
    open: 'Nothing waiting for review.',
    reviewing: 'Reports being worked on show up here.',
    actioned: 'Reports where action was taken show up here.',
    dismissed: 'Dismissed reports show up here.',
  };

  return (
    <Screen header={header} edges={['top', 'bottom']} onRefresh={() => { reports.refetch(); }} refreshing={reports.isRefetching}>
      <SegmentedControl<ReportStatus>
        options={[
          { value: 'open', label: 'Open' }, { value: 'reviewing', label: 'Reviewing' },
          { value: 'actioned', label: 'Actioned' }, { value: 'dismissed', label: 'Dismissed' },
        ]}
        value={status}
        onChange={(s) => {
          setStatus(s);
          reset();
        }}
      />
      <Banner tone="warning" icon="eye-outline" body="Reporter identity is visible to platform administrators only. Never share it with the reported person or Server staff." />

      {reports.isLoading ? (
        <LoadingList count={2} />
      ) : reports.isError ? (
        <ErrorState error={reports.error} onRetry={() => { reports.refetch(); }} />
      ) : list.length === 0 ? (
        <EmptyState icon="shield-checkmark-outline" title="No reports here" body={emptyBody[status]} />
      ) : (
        list.map((r) => {
          const composing = compose?.reportId === r.id ? compose.action : null;
          const open = status === 'open' || status === 'reviewing';
          return (
            <Card key={r.id} style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                  <Tag label={REASON_LABEL[r.reason]} tone="warning" small />
                  {r.server_name ? <Tag label={r.server_name} icon="server-outline" small /> : <Tag label="No Server" small />}
                </View>
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

              {r.target ? <Mini label="Reported" person={r.target} /> : null}
              {r.reporter ? <Mini label="Reporter" person={r.reporter} /> : <Text variant="caption" color="textTertiary">Reporter deleted their account.</Text>}

              {r.resolution_note ? (
                <Text variant="caption" color="textSecondary">
                  Note: {r.resolution_note}
                </Text>
              ) : null}

              {composing ? (
                <View style={{ gap: 10 }}>
                  <TextField
                    label={
                      composing === 'actioned' ? 'What was done? (optional)'
                      : composing === 'dismissed' ? 'Why dismiss? (optional)'
                      : composing === 'suspend' ? 'Reason for suspension (kept in the audit log)'
                      : 'Reason for reinstating (optional)'
                    }
                    value={note}
                    onChangeText={setNote}
                    maxCount={500}
                    multiline
                  />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Button title="Cancel" variant="secondary" size="sm" style={{ flex: 1 }} onPress={reset} />
                    {composing === 'actioned' || composing === 'dismissed' ? (
                      <Button
                        title={composing === 'actioned' ? 'Mark action taken' : 'Dismiss'}
                        size="sm"
                        style={{ flex: 1 }}
                        loading={review.isPending}
                        onPress={() => setReportStatus(r, composing, note.trim() || null)}
                      />
                    ) : (
                      <Button
                        title={composing === 'suspend' ? 'Suspend account' : 'Reinstate account'}
                        size="sm"
                        variant={composing === 'suspend' ? 'danger' : 'primary'}
                        style={{ flex: 1 }}
                        loading={account.isPending}
                        disabled={composing === 'suspend' && note.trim().length < 3}
                        onPress={() => changeAccount(r, composing === 'suspend' ? 'suspended' : 'active')}
                      />
                    )}
                  </View>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {open ? (
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      {status === 'open' ? (
                        <Button title="Reviewing" size="sm" variant="secondary" icon="eye-outline" loading={review.isPending && review.variables?.reportId === r.id} onPress={() => setReportStatus(r, 'reviewing', null)} />
                      ) : null}
                      <Button title="Action taken" size="sm" icon="checkmark" onPress={() => { setNote(''); setCompose({ reportId: r.id, action: 'actioned' }); }} />
                      <Button title="Dismiss" size="sm" variant="ghost" onPress={() => { setNote(''); setCompose({ reportId: r.id, action: 'dismissed' }); }} />
                    </View>
                  ) : null}
                  {r.target ? (
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <Button title="View profile" size="sm" variant="secondary" icon="person-outline" onPress={() => router.push(`/user/${r.target!.id}`)} />
                      <Button title="Suspend account" size="sm" variant="danger" icon="ban-outline" onPress={() => { setNote(''); setCompose({ reportId: r.id, action: 'suspend' }); }} />
                      <Button title="Reinstate" size="sm" variant="ghost" onPress={() => { setNote(''); setCompose({ reportId: r.id, action: 'reinstate' }); }} />
                    </View>
                  ) : null}
                </View>
              )}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
