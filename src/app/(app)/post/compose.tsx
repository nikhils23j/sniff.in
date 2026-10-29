import Ionicons from '@expo/vector-icons/Ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, View } from 'react-native';
import type { z } from 'zod';

import { ServerIcon } from '@/components/ServerCard';
import { MediaQualityControl } from '@/components/MediaQualityControl';
import {
  AppHeader, Banner, Button, EmptyState, ErrorState, IconButton, ListGroup, LoadingList, RadioGroup, Screen, Tag, TagList, Text, TextField, toast,
} from '@/components/ui';
import { useSignedUrl } from '@/features/media/hooks';
import { useMyServers } from '@/features/servers/hooks';
import { useUploadPostImage } from '@/features/social/activity-media';
import { validateAttachment } from '@/features/social/chat-media';
import { pickPhoto, takePhoto } from '@/features/social/chat-pickers';
import { useCreatePost, useUpdatePost } from '@/features/social/hooks';
import { useTheme } from '@/theme';
import { postSchema } from '@/lib/validation';
import type { PostCategory } from '@/types/domain';

type PostForm = z.infer<typeof postSchema>;

type PhotoChoice = { kind: 'existing'; path: string } | { kind: 'new'; uri: string };
type Extras = { capacity: number | null; photos: PhotoChoice[] };

const CAPACITY_PRESETS: { value: string; label: string }[] = [
  { value: 'none', label: 'No limit' },
  { value: '2', label: '2' },
  { value: '4', label: '4' },
  { value: '6', label: '6' },
  { value: '10', label: '10' },
  { value: 'custom', label: 'Custom' },
];

const CATEGORIES: { value: PostCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'social', label: 'Social', icon: 'people-outline' },
  { value: 'sports', label: 'Sports', icon: 'basketball-outline' },
  { value: 'travel', label: 'Travel', icon: 'airplane-outline' },
  { value: 'professional', label: 'Professional', icon: 'briefcase-outline' },
  { value: 'study', label: 'Study', icon: 'book-outline' },
  { value: 'food', label: 'Food', icon: 'restaurant-outline' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
];

const EXPIRY: { value: number; label: string }[] = [
  { value: 6, label: '6 hours' },
  { value: 24, label: '24 hours' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
  { value: 720, label: '30 days' },
];

const isCategory = (v: unknown): v is PostCategory => CATEGORIES.some((c) => c.value === v);
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function ComposePostScreen() {
  const params = useLocalSearchParams<{ postId?: string; serverId?: string; body?: string; category?: string; capacity?: string; imagePath?: string; imagePaths?: string }>();
  const postId = first(params.postId);
  const editing = !!postId;
  const servers = useMyServers();
  const create = useCreatePost();
  const update = useUpdatePost();
  const upload = useUploadPostImage();

  const liveServers = useMemo(() => (servers.data ?? []).filter((s) => s.status === 'active' && s.is_live), [servers.data]);

  if (servers.isLoading) {
    return (
      <Screen header={<AppHeader title={editing ? 'Edit post' : 'New post'} back={false} />}>
        <LoadingList count={2} />
      </Screen>
    );
  }
  if (servers.isError) {
    return (
      <Screen header={<AppHeader title={editing ? 'Edit post' : 'New post'} back={false} right={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />}>
        <ErrorState error={servers.error} onRetry={() => { servers.refetch(); }} />
      </Screen>
    );
  }
  if (liveServers.length === 0) {
    return (
      <Screen header={<AppHeader title="New post" back={false} right={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />}>
        <EmptyState
          title="Join a Server first"
          body="Posts live inside a Server, so people there can see them. Join one by scanning a QR code or using an invite."
          action={{ label: 'Join a Server', icon: 'qr-code', onPress: () => router.replace('/join') }}
        />
      </Screen>
    );
  }

  const initialServer = first(params.serverId);
  return (
    <ComposeForm
      postId={postId}
      initial={{
        serverId: liveServers.find((s) => s.id === initialServer)?.id ?? (liveServers.length === 1 ? liveServers[0].id : ''),
        body: first(params.body) ?? '',
        category: isCategory(first(params.category)) ? (first(params.category) as PostCategory) : 'social',
      }}
      servers={liveServers}
      initialCapacity={Number(first(params.capacity)) || null}
      initialImagePaths={(() => {
        try { const paths: unknown = JSON.parse(first(params.imagePaths) ?? 'null');
          return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string').slice(0, 6) : first(params.imagePath) ? [first(params.imagePath)!] : [];
        } catch { return first(params.imagePath) ? [first(params.imagePath)!] : []; }
      })()}
      busy={create.isPending || update.isPending || upload.isPending}
      onSubmit={async (v, extra, onProgress) => {
        try {
          const imagePaths: string[] = [];
          for (let i = 0; i < extra.photos.length; i++) {
            const photo = extra.photos[i];
            imagePaths.push(photo.kind === 'existing' ? photo.path : await upload.mutateAsync({
              serverId: v.serverId, uri: photo.uri, onProgress: (fraction) => onProgress((i + fraction) / extra.photos.length),
            }));
          }
          if (postId) {
            await update.mutateAsync({
              postId, body: v.body, category: v.category, expiresHours: v.expiresHours, capacity: extra.capacity,
              imagePaths,
            });
            toast.success('Post updated');
          } else {
            await create.mutateAsync({ serverId: v.serverId, body: v.body, category: v.category, expiresHours: v.expiresHours, capacity: extra.capacity, imagePaths });
            toast.success('Posted to your Server');
          }
          router.back();
        } catch (e) {
          toast.error(e);
        }
      }}
    />
  );
}

function PhotoPreview({ photo }: { photo: PhotoChoice }) {
  const { colors, radius } = useTheme();
  const existing = useSignedUrl('activity-media', photo.kind === 'existing' ? photo.path : null);
  const uri = photo.kind === 'new' ? photo.uri : existing.data;
  return (
    <View style={{ width: 106, height: 106, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceMuted }}>
      {uri ? <Image source={{ uri }} contentFit="cover" style={{ flex: 1 }} accessibilityLabel="Selected photo preview" /> : null}
    </View>
  );
}

function ComposeForm({
  postId, initial, initialCapacity, initialImagePaths, servers, busy, onSubmit,
}: {
  postId?: string;
  initial: { serverId: string; body: string; category: PostCategory };
  initialCapacity: number | null;
  initialImagePaths: string[];
  servers: NonNullable<ReturnType<typeof useMyServers>['data']>;
  busy: boolean;
  onSubmit: (v: PostForm, extra: Extras, onProgress: (fraction: number) => void) => void;
}) {
  const { colors } = useTheme();
  const editing = !!postId;
  const [photos, setPhotos] = useState<PhotoChoice[]>(initialImagePaths.map((path) => ({ kind: 'existing', path })));
  const [progress, setProgress] = useState<number | null>(null);
  const [capMode, setCapMode] = useState<string>(
    initialCapacity === null ? 'none' : CAPACITY_PRESETS.some((p) => p.value === String(initialCapacity)) ? String(initialCapacity) : 'custom',
  );
  const [customCap, setCustomCap] = useState(initialCapacity ? String(initialCapacity) : '');
  const customValue = Number(customCap);
  const customValid = Number.isInteger(customValue) && customValue >= 1 && customValue <= 500;
  const capacityError = capMode === 'custom' && !customValid ? 'Enter a whole number from 1 to 500' : undefined;
  const capacity = capMode === 'none' ? null : capMode === 'custom' ? (customValid ? customValue : null) : Number(capMode);

  const choosePhoto = async (source: 'library' | 'camera') => {
    try {
      const file = await (source === 'camera' ? takePhoto : pickPhoto)();
      if (!file) return;
      validateAttachment(file);
      if (photos.length >= 6) return toast.error('Up to six photos per post.');
      setPhotos((current) => [...current, { kind: 'new', uri: file.uri }]);
    } catch (e) {
      toast.error(e);
    }
  };
  const { control, handleSubmit, watch, formState: { errors } } = useForm<PostForm>({
    resolver: zodResolver(postSchema),
    defaultValues: {
      body: initial.body,
      category: initial.category,
      serverId: initial.serverId,
      // Editing keeps the current expiry unless the author picks a new one; new posts default to 7 days.
      expiresHours: editing ? null : 168,
    },
  });
  const serverId = watch('serverId');
  const body = watch('body');
  const selected = servers.find((s) => s.id === serverId);

  return (
    <Screen
      header={<AppHeader title={editing ? 'Edit post' : 'New post'} back={false} right={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />}
      edges={['top', 'bottom']}
      footer={
        <View style={{ gap: 8 }}>
          {busy && progress !== null && progress < 1 ? (
            <View accessibilityRole="progressbar" accessibilityLabel={`Uploading photo ${Math.round(progress * 100)} percent`} style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
              <View style={{ height: 6, width: `${Math.max(4, Math.round(progress * 100))}%`, backgroundColor: colors.primary }} />
            </View>
          ) : null}
          <Button
            title={editing ? 'Save changes' : 'Post'}
            size="lg"
            fullWidth
            loading={busy}
            disabled={!!capacityError}
            onPress={() => {
              setProgress(photos.some((p) => p.kind === 'new') ? 0 : null);
              handleSubmit((v) => onSubmit(v, { capacity, photos }, setProgress))();
            }}
          />
        </View>
      }>
      <Text variant="callout" color="textSecondary">
        Say what you are up for. People in the Server can reply &ldquo;I&apos;m in&rdquo;, and you decide who to connect with.
      </Text>

      <View style={{ gap: 8 }}>
        <Text variant="heading" accessibilityRole="header">
          Server
        </Text>
        {editing ? (
          <ListGroup>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
              {selected ? <ServerIcon category={selected.category} size={36} /> : null}
              <View style={{ flex: 1 }}>
                <Text variant="callout">{selected?.name ?? 'Your Server'}</Text>
                <Text variant="caption" color="textSecondary">
                  A post stays in the Server it was created in.
                </Text>
              </View>
            </View>
          </ListGroup>
        ) : (
          <Controller
            control={control}
            name="serverId"
            render={({ field }) => (
              <RadioGroup
                options={servers.map((s) => ({ value: s.id, label: s.name, description: s.kind === 'short_term' ? 'Event Server' : s.parent_name ? `in ${s.parent_name}` : undefined }))}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        )}
        {errors.serverId ? (
          <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
            {errors.serverId.message}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="heading" accessibilityRole="header">
          Category
        </Text>
        <Controller
          control={control}
          name="category"
          render={({ field }) => (
            <TagList>
              {CATEGORIES.map((c) => (
                <Tag key={c.value} label={c.label} icon={c.icon} selected={field.value === c.value} onPress={() => field.onChange(c.value)} />
              ))}
            </TagList>
          )}
        />
      </View>

      <Controller
        control={control}
        name="body"
        render={({ field }) => (
          <TextField
            label="What is the plan?"
            placeholder="Who wants to play badminton tomorrow morning?"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            multiline
            maxCount={500}
            error={errors.body?.message}
            hint={body.length === 0 ? 'e.g. “Looking for two more people for a Kedarnath trip”' : undefined}
          />
        )}
      />

      <View style={{ gap: 8 }}>
        <Text variant="heading" accessibilityRole="header">
          Photos <Text variant="caption" color="textTertiary">(up to 6)</Text>
        </Text>
        <MediaQualityControl />
        {photos.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {photos.map((photo, index) => <View key={photo.kind === 'existing' ? photo.path : photo.uri} style={{ gap: 4 }}>
            <PhotoPreview photo={photo} />
            <Button title="Remove" size="sm" variant="ghost" onPress={() => setPhotos((list) => list.filter((_, i) => i !== index))} />
          </View>)}
        </View> : null}
        {photos.length < 6 ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {([['library', 'Photo library', 'images-outline'], ['camera', 'Camera', 'camera-outline']] as const).map(([src, label, icon]) => (
              <Pressable
                key={src}
                accessibilityRole="button"
                accessibilityLabel={`Add a photo from ${label.toLowerCase()}`}
                onPress={() => choosePhoto(src)}
                style={({ pressed }) => ({
                  flex: 1, minHeight: 84, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong,
                  alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                })}>
                <Ionicons name={icon} size={24} color={colors.primary} />
                <Text variant="caption" color="textSecondary">{label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="heading" accessibilityRole="header">
          Spots <Text variant="caption" color="textTertiary">(optional)</Text>
        </Text>
        <TagList>
          {CAPACITY_PRESETS.map((p) => (
            <Tag key={p.value} label={p.label} selected={capMode === p.value} onPress={() => setCapMode(p.value)} />
          ))}
        </TagList>
        {capMode === 'custom' ? (
          <TextField
            label="Number of spots (1 to 500)"
            value={customCap}
            onChangeText={(t) => setCustomCap(t.replace(/[^0-9]/g, '').slice(0, 3))}
            keyboardType="number-pad"
            placeholder="e.g. 8"
            error={capacityError}
          />
        ) : (
          <Text variant="caption" color="textTertiary">
            {capMode === 'none' ? 'Anyone can say they are in.' : `Once ${capMode} people are in, the plan shows as full.`}
          </Text>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="heading" accessibilityRole="header">
          {editing ? 'Expiry' : 'Expires after'}
        </Text>
        <Controller
          control={control}
          name="expiresHours"
          render={({ field }) => (
            <RadioGroup<number>
              options={[
                ...(editing ? [{ value: 0, label: 'Keep current expiry' }] : []),
                ...EXPIRY.map((e) => ({ value: e.value, label: e.label, description: !editing && e.value === 168 ? 'Default' : undefined })),
              ]}
              value={field.value ?? 0}
              onChange={(v) => field.onChange(v === 0 ? null : v)}
            />
          )}
        />
        {selected?.kind === 'short_term' ? (
          <Banner tone="info" icon="calendar-outline" body={`${selected.name} is an event Server. Your post ends when the event does, even if the expiry above is later.`} />
        ) : (
          <Text variant="caption" color="textTertiary">
            Expired posts disappear from Activity. This is not an endless feed.
          </Text>
        )}
      </View>
    </Screen>
  );
}
