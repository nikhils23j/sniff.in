import { router } from 'expo-router';
import { View } from 'react-native';

import { ProfileBody } from '@/components/ProfileBody';
import { AppHeader, Banner, Button, ErrorState, Screen, Skeleton } from '@/components/ui';
import { usePreviewMyProfile } from '@/features/profile/hooks';

function PreviewSkeleton() {
  return (
    <View accessibilityLabel="Loading preview" style={{ alignItems: 'center', gap: 12, paddingTop: 12 }}>
      <Skeleton width={104} height={104} radius={52} />
      <Skeleton width={180} height={22} />
      <Skeleton width={110} height={14} />
      <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 16 }}>
        <Skeleton height={110} radius={20} />
        <Skeleton height={90} radius={20} />
      </View>
    </View>
  );
}

/** Your profile exactly as any member who isn't connected to you sees it. */
export default function ProfilePreviewScreen() {
  const preview = usePreviewMyProfile();
  const edit = () => router.push('/profile/edit');

  return (
    <Screen
      header={<AppHeader title="Preview" right={<Button title="Edit" size="sm" variant="secondary" icon="create-outline" onPress={edit} />} />}
      onRefresh={() => { void preview.refetch(); }}
      refreshing={preview.isRefetching}>
      <Banner
        tone="info"
        icon="eye-outline"
        body="This is how members see your profile. Fields set to Connections or Only me are hidden."
        action={{ label: 'Change who sees what', onPress: () => router.push('/settings/privacy') }}
      />
      {preview.isLoading ? (
        <PreviewSkeleton />
      ) : preview.isError || !preview.data ? (
        <ErrorState error={preview.error ?? new Error('unknown')} onRetry={() => { void preview.refetch(); }} />
      ) : (
        <ProfileBody profile={preview.data} />
      )}
    </Screen>
  );
}
