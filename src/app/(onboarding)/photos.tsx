import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { Text, toast } from '@/components/ui';
import { useUserId } from '@/features/auth/session-store';
import { useThumbnailUrl } from '@/features/media/hooks';
import { useAddProfilePhoto, useMe, useProfile, useUploadAvatar } from '@/features/profile/hooks';
import { useTheme } from '@/theme';

function PhotoTile({ path, index }: { path: string; index: number }) {
  const t = useTheme(); const url = useThumbnailUrl('profile-photos', path);
  return <View accessibilityLabel={`Profile photo ${index + 1}`} style={{ width: '31%', aspectRatio: 0.8, borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.surfaceMuted }}>
    {url.data ? <Image source={{ uri: url.data }} style={{ flex: 1 }} contentFit="cover" /> : null}
  </View>;
}

export default function PhotosStep() {
  const t = useTheme(); const uid = useUserId(); const me = useMe(); const profile = useProfile(uid ?? undefined);
  const add = useAddProfilePhoto(); const uploadAvatar = useUploadAvatar(); const [uploading, setUploading] = useState(false);
  const photos = profile.data?.photos ?? []; const free = Math.max(0, 6 - photos.length);
  const pick = async () => {
    if (!uid || !free) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: free, quality: 1 });
    if (result.canceled) return;
    setUploading(true);
    try {
      for (const asset of result.assets.slice(0, free)) await add.mutateAsync(asset.uri);
      if (!me.data?.avatar_path && result.assets[0]) await uploadAvatar.mutateAsync({ uri: result.assets[0].uri, previous: null });
      toast.success(result.assets.length === 1 ? 'Photo added' : `${Math.min(result.assets.length, free)} photos added`);
    } catch (e) { toast.error(e); } finally { setUploading(false); }
  };
  return <OnboardingScaffold step={14} title="Show a little of your world" body="Add up to six photos. Photos only—videos are not used in profiles." onNext={() => router.push('/prompts')} skipTo="/prompts" loading={uploading}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {photos.map((photo, index) => <PhotoTile key={photo.id} path={photo.storage_path} index={index} />)}
      {Array.from({ length: free }, (_, index) => <Pressable key={`empty-${index}`} accessibilityRole="button" accessibilityLabel="Add a profile photo" onPress={() => void pick()}
        style={({ pressed }) => ({ width: '31%', aspectRatio: 0.8, borderRadius: t.radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.borderStrong,
          backgroundColor: pressed ? t.colors.primarySoft : t.colors.surface, alignItems: 'center', justifyContent: 'center', gap: 5 })}>
        <Ionicons name="add-circle-outline" size={28} color={t.colors.primary} /><Text variant="micro" color="textSecondary">Add photo</Text>
      </Pressable>)}
    </View>
    <Text variant="callout" color="textSecondary">{photos.length}/6 photos · your first upload also becomes your main profile picture.</Text>
  </OnboardingScaffold>;
}
