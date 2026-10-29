import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { ProfileBody } from '@/components/ProfileBody';
import { Button, Card, ErrorState, IconButton, LoadingList, Screen, Text } from '@/components/ui';
import { useUserId } from '@/features/auth/session-store';
import { useMe, useMyTags, useProfile } from '@/features/profile/hooks';
import { useTheme } from '@/theme';

export default function MeScreen() {
  const t = useTheme(); const uid = useUserId(); const me = useMe(); const tags = useMyTags(); const profile = useProfile(uid ?? undefined);
  if (me.isLoading || profile.isLoading) return <Screen><View style={{ flexDirection: 'row' }}><Text variant="title" style={{ flex: 1 }}>Me</Text><IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} /></View><LoadingList count={3} /></Screen>;
  if (me.isError || profile.isError || !me.data || !profile.data) return <Screen><Text variant="title">Me</Text><ErrorState error={me.error ?? profile.error ?? new Error('Profile unavailable')} onRetry={() => { void me.refetch(); void profile.refetch(); }} /></Screen>;
  const p = me.data; const interests = (tags.data ?? []).filter((x) => x.kind === 'interest' || x.kind === 'hobby').length;
  const checks = [!!p.avatar_path, !!p.bio, !!(p.school_name || p.university), !!(p.job_title || p.occupation), interests >= 3, (profile.data.photos?.length ?? 0) > 0];
  const pct = Math.round(checks.filter(Boolean).length / checks.length * 100);
  return <Screen onRefresh={() => Promise.all([me.refetch(), profile.refetch(), tags.refetch()])} refreshing={me.isRefetching}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>Me</Text><IconButton icon="settings-outline" label="Settings and privacy" onPress={() => router.push('/settings')} /></View>
    {pct < 100 ? <Card style={{ gap: 9 }}><View style={{ flexDirection: 'row', alignItems: 'center' }}><Ionicons name="sparkles" size={18} color={t.colors.primary} /><Text variant="subheading" style={{ flex: 1, marginLeft: 8 }}>Profile strength</Text><Text variant="subheading" color="primary">{pct}%</Text></View><View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceMuted }}><View style={{ height: 6, width: `${pct}%`, borderRadius: 3, backgroundColor: t.colors.primary }} /></View><Button title="Complete your profile" variant="ghost" size="sm" onPress={() => router.push('/profile/edit')} /></Card> : null}
    <ProfileBody profile={profile.data} onAvatarPress={() => router.push('/profile/preview')} onFriendsPress={() => router.push('/friends')}
      actions={<View style={{ alignItems: 'center', gap: 8 }}><Button title="Edit profile" variant="secondary" icon="create-outline" onPress={() => router.push('/profile/edit')} /><Text variant="caption" color="textTertiary">Tap your photo to see your public preview</Text></View>} />
  </Screen>;
}
