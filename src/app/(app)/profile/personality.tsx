import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { PromptChooser, type PromptAnswer } from '@/components/PromptChooser';

import {
  AppHeader, Banner, Button, Card, ErrorState, IconButton, LoadingList, Screen, Skeleton, Text, confirm, toast,
} from '@/components/ui';
import { useUserId } from '@/features/auth/session-store';
import { useSignedUrl, useThumbnailUrl } from '@/features/media/hooks';
import { useAddProfilePhoto, useProfile, useRemoveProfilePhoto, useSetPrompt } from '@/features/profile/hooks';
import { MAX_PROFILE_PHOTOS, MAX_PROFILE_PROMPTS, PROFILE_PROMPTS } from '@/features/profile/prompts';
import { toAppError } from '@/lib/errors';
import { useTheme } from '@/theme';

function Photo({ path, index, onPress }: { path: string; index: number; onPress: () => void }) {
  const image = useThumbnailUrl('profile-photos', path);
  const { colors, radius } = useTheme();
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={`View photo ${index + 1}`} onPress={onPress}
      style={{ width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceMuted }}>
      {image.data ? <Image source={{ uri: image.data }} style={{ flex: 1 }} contentFit="cover" /> : null}
    </Pressable>
  );
}

function PhotosSkeleton() {
  return (
    <View accessibilityLabel="Loading photos" style={{ flexDirection: 'row', gap: 10 }}>
      <Skeleton width={96} height={96} radius={14} />
      <Skeleton width={96} height={96} radius={14} />
      <Skeleton width={96} height={96} radius={14} />
    </View>
  );
}

export default function PersonalityScreen() {
  const uid = useUserId();
  const profile = useProfile(uid ?? undefined);
  const addPhoto = useAddProfilePhoto();
  const removePhotoMut = useRemoveProfilePhoto();
  const setPrompt = useSetPrompt();
  const { colors } = useTheme();
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [fullPhoto, setFullPhoto] = useState<string | null>(null);
  const fullUrl = useSignedUrl('profile-photos', fullPhoto);
  const loaded = !!profile.data;
  const photos = [...(profile.data?.photos ?? [])].sort((a, b) => a.position - b.position);
  const answers = profile.data?.prompt_answers ?? [];
  const free = MAX_PROFILE_PHOTOS - photos.length;

  const addPhotos = async () => {
    if (!loaded || free <= 0 || adding) return;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: free, quality: 1,
      });
      if (picked.canceled || !picked.assets.length) return;
      const assets = picked.assets.slice(0, free);
      let added = 0;
      setAdding({ done: 0, total: assets.length });
      for (const asset of assets) {
        try {
          await addPhoto.mutateAsync(asset.uri);
          added += 1;
          setAdding({ done: added, total: assets.length });
        } catch (error) {
          if (toAppError(error).code === 'too_many_photos') {
            toast.info(`You can add up to ${MAX_PROFILE_PHOTOS} extra photos. Remove one to add another.`);
            break;
          }
          throw error;
        }
      }
      if (added) toast.success(added === 1 ? 'Photo added' : `${added} photos added`);
    } catch (error) {
      toast.error(error);
    } finally {
      setAdding(null);
    }
  };

  const removePhoto = async (id: string) => {
    if (!await confirm({ title: 'Remove photo?', message: 'It disappears from your profile.', confirmLabel: 'Remove', destructive: true })) return;
    removePhotoMut.mutate(id, { onSuccess: () => toast.success('Photo removed'), onError: toast.error });
  };

  const savePrompt = async (next: PromptAnswer) => {
    const prior = activeSlot === null ? null : answers[activeSlot];
    if (prior && prior.prompt_key !== next.prompt_key) await setPrompt.mutateAsync({ key: prior.prompt_key, answer: '' });
    try {
      await setPrompt.mutateAsync({ key: next.prompt_key, answer: next.answer });
      toast.success('Answer saved');
    } catch (error) {
      if (prior && prior.prompt_key !== next.prompt_key) await setPrompt.mutateAsync({ key: prior.prompt_key, answer: prior.answer }).catch(() => {});
      throw error;
    }
  };
  const removePrompt = async () => {
    const prior = activeSlot === null ? null : answers[activeSlot];
    if (prior) await setPrompt.mutateAsync({ key: prior.prompt_key, answer: '' });
    toast.success('Answer removed');
  };

  const header = <AppHeader title="Photos & prompts" />;

  if (profile.isError && !profile.data) {
    return (
      <Screen header={header}>
        <ErrorState error={profile.error} onRetry={() => { void profile.refetch(); }} />
      </Screen>
    );
  }

  return (
    <Screen header={header} onRefresh={() => { void profile.refetch(); }} refreshing={profile.isRefetching}>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text variant="heading" accessibilityRole="header">Photos</Text>
          {loaded ? <Text variant="callout" color="textSecondary">{photos.length} / {MAX_PROFILE_PHOTOS} photos</Text> : null}
        </View>
        <Text variant="callout" color="textSecondary">
          Add up to {MAX_PROFILE_PHOTOS} photos beyond your main picture. They show on your profile to anyone who can open it.
        </Text>
      </View>

      {profile.isLoading ? <PhotosSkeleton /> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {photos.map((photo, i) => {
            const removing = removePhotoMut.isPending && removePhotoMut.variables === photo.id;
            return (
              <View key={photo.id} style={{ gap: 4, alignItems: 'center', opacity: removing ? 0.5 : 1 }}>
                <Photo path={photo.storage_path} index={i} onPress={() => setFullPhoto(photo.storage_path)} />
                <Button title="Remove" size="sm" variant="ghost" icon="trash-outline" disabled={removing} onPress={() => void removePhoto(photo.id)} />
              </View>
            );
          })}
        </View>
      )}

      {loaded && free <= 0 ? (
        <Banner tone="info" icon="images-outline" body={`You have ${MAX_PROFILE_PHOTOS} photos, the maximum. Remove one to add another.`} />
      ) : (
        <Button
          title={adding ? `Uploading ${Math.min(adding.done + 1, adding.total)} of ${adding.total}…` : 'Add photos'}
          variant="secondary"
          icon="images-outline"
          loading={!!adding}
          disabled={!loaded || !!adding}
          onPress={() => void addPhotos()}
        />
      )}

      <View style={{ gap: 4 }}>
        <Text variant="heading" accessibilityRole="header">Conversation starters</Text>
        <Text variant="callout" color="textSecondary">Choose up to three prompts. Tap a slot to add, edit or replace an answer.</Text>
      </View>
      {profile.isLoading ? <LoadingList count={3} /> : Array.from({ length: MAX_PROFILE_PROMPTS }, (_, i) => {
        const existing = answers[i];
        return <Card key={i} onPress={() => setActiveSlot(i)} accessibilityLabel={existing ? `Edit ${existing.prompt_key}` : `Add prompt ${i + 1}`}
          style={{ minHeight: 92, borderRadius: 20, gap: 7, justifyContent: 'center' }}>
          <Text variant="caption" color="primary">{existing ? 'YOUR PROMPT' : `PROMPT ${i + 1}`}</Text>
          <Text variant="bodyStrong">{existing ? PROFILE_PROMPTS.find((p) => p.key === existing.prompt_key)?.title : '+ Add a prompt'}</Text>
          {existing ? <Text variant="callout" color="textSecondary">{existing.answer}</Text> : null}
        </Card>;
      })}
      {activeSlot !== null ? <PromptChooser key={`slot-${activeSlot}-${answers[activeSlot]?.prompt_key ?? 'empty'}`}
        visible current={answers[activeSlot] ?? null} used={answers.map((a) => a.prompt_key)} busy={setPrompt.isPending}
        onClose={() => setActiveSlot(null)} onSave={savePrompt} onRemove={removePrompt} /> : null}

      <Modal visible={!!fullPhoto} animationType="fade" onRequestClose={() => setFullPhoto(null)} transparent>
        <Pressable accessibilityLabel="Close photo" onPress={() => setFullPhoto(null)} style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20, gap: 12 }}>
          {fullUrl.data ? <Image source={{ uri: fullUrl.data }} style={{ width: '100%', height: '80%' }} contentFit="contain" /> : null}
          <Button title="Close" variant="secondary" onPress={() => setFullPhoto(null)} />
        </Pressable>
      </Modal>
    </Screen>
  );
}
