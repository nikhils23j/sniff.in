import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppHeader, Banner, Button, EmptyState, IconButton, RadioGroup, Screen, SectionHeader, SwitchRow, Text, TextField, toast,
} from '@/components/ui';
import { useBlockUser, useReport } from '@/features/social/hooks';
import { useTheme } from '@/theme';
import type { ReportReason } from '@/types/domain';

const REASONS: { value: ReportReason; label: string; description: string }[] = [
  { value: 'spam', label: 'Spam or scam', description: 'Unwanted promotion, links, or attempts to get money.' },
  { value: 'harassment', label: 'Harassment or bullying', description: 'Abusive, threatening or unwanted repeated contact.' },
  { value: 'inappropriate', label: 'Inappropriate content', description: 'Sexual, hateful or otherwise offensive content.' },
  { value: 'fake_profile', label: 'Fake or misleading profile', description: 'Pretending to be someone else or lying about who they are.' },
  { value: 'safety', label: 'Safety concern', description: 'Makes you feel unsafe, or talks about hurting themselves or others.' },
  { value: 'underage', label: 'Seems under 18', description: 'Sniff.in is for adults only.' },
  { value: 'other', label: 'Something else', description: 'Tell us more below.' },
];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default function ReportScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ userId?: string; postId?: string; messageId?: string; serverId?: string }>();
  const userId = first(params.userId);
  const postId = first(params.postId);
  const messageId = first(params.messageId);
  const serverId = first(params.serverId);

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(!!userId || !!messageId);
  const [done, setDone] = useState<{ blocked: boolean } | null>(null);
  const report = useReport();
  const block = useBlockUser();

  const hasTarget = !!userId || !!postId || !!messageId;
  const what = messageId ? 'message' : postId ? 'post' : 'person';
  const canBlock = !!userId;
  const submitting = report.isPending || block.isPending;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const submit = async () => {
    if (!reason) return;
    try {
      await report.mutateAsync({
        reason, details: details.trim() || null, userId: userId ?? null, postId: postId ?? null,
        messageId: messageId ?? null, serverId: serverId ?? null,
      });
    } catch (e) {
      toast.error(e);
      return;
    }
    let blocked = false;
    if (alsoBlock && canBlock && userId) {
      try {
        await block.mutateAsync(userId);
        blocked = true;
      } catch {
        toast.error("Your report was sent, but we couldn't block them. You can block them from their profile.");
      }
    }
    setDone({ blocked });
  };

  const closeButton = <IconButton icon="close" label="Close" onPress={close} />;

  if (done) {
    return (
      <Screen header={<AppHeader title="Report" back={false} right={closeButton} />} footer={<Button title="Done" size="lg" onPress={close} />}>
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 32 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="checkmark" size={36} color={colors.success} />
          </View>
          <Text variant="title" align="center">
            Thanks for telling us
          </Text>
          <Text variant="body" color="textSecondary" align="center" style={{ maxWidth: 340 }}>
            Thanks — our moderators will review this. The person isn&apos;t told who reported them.
          </Text>
          {done.blocked ? (
            <Text variant="callout" color="textSecondary" align="center">
              You&apos;ve also blocked them. You can undo this any time in Settings.
            </Text>
          ) : null}
        </View>
      </Screen>
    );
  }

  if (!hasTarget) {
    return (
      <Screen header={<AppHeader title="Report" back={false} right={closeButton} />}>
        <EmptyState icon="flag-outline" title="Nothing to report" body="Open a profile, message or post and choose Report from its menu." action={{ label: 'Close', onPress: close }} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<AppHeader title={`Report this ${what}`} back={false} right={closeButton} />}
      footer={<Button title="Submit report" size="lg" icon="flag" disabled={!reason} loading={submitting} onPress={submit} />}>
      <Text variant="callout" color="textSecondary">
        Tell us what&apos;s wrong. Reports are confidential and reviewed by our moderators. We keep a copy of the reported content so it can be reviewed even if it&apos;s deleted.
      </Text>

      <SectionHeader title="What's the problem?" />
      <RadioGroup options={REASONS} value={reason ?? ('' as ReportReason)} onChange={setReason} />

      <TextField
        label="Anything else we should know? (optional)"
        placeholder="What happened, and when?"
        multiline
        maxCount={1000}
        value={details}
        onChangeText={setDetails}
      />

      {canBlock ? (
        <View style={{ gap: 6 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
            <SwitchRow
              icon="ban-outline"
              title="Also block this person"
              subtitle="They won't be able to see or contact you, and any chat closes."
              value={alsoBlock}
              onValueChange={setAlsoBlock}
            />
          </View>
        </View>
      ) : null}

      <Banner
        tone="danger"
        icon="warning"
        title="In immediate danger?"
        body="Contact local emergency services right away (112 in India). Reports aren't monitored in real time."
      />
    </Screen>
  );
}
