import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Share, useWindowDimensions, View } from 'react-native';

import { ImageViewer } from '@/components/chat/ImageViewer';
import { AppHeader, Avatar, Button, Card, confirm, EmptyState, ErrorState, LoadingList, Screen, Tag, Text, TextField, toast } from '@/components/ui';
import { useSignedUrl, useThumbnailUrl } from '@/features/media/hooks';
import { useActivityPost, useSetPostResponse } from '@/features/social/hooks';
import { env } from '@/lib/env';
import { toAppError } from '@/lib/errors';
import { useTheme } from '@/theme';

function GalleryImage({ path, width, onOpen }: { path: string; width: number; onOpen: () => void }) {
  const { colors } = useTheme();
  const image = useThumbnailUrl('activity-media', path);
  return <Pressable accessibilityRole="imagebutton" accessibilityLabel="Open activity photo" onPress={onOpen}
    style={{ width, height: 240, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surfaceMuted }}>
    {image.data ? <Image source={{ uri: image.data }} contentFit="cover" style={{ flex: 1 }} transition={150} /> : null}
  </Pressable>;
}

export default function ActivityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const post = useActivityPost(id);
  const { width: windowWidth } = useWindowDimensions();
  const galleryWidth = windowWidth - 72;
  const respond = useSetPostResponse();
  const [message, setMessage] = useState('');
  const [imageIndex, setImageIndex] = useState(0);
  const [viewer, setViewer] = useState(false);
  const p = post.data;
  const paths = p?.image_paths ?? (p?.image_path ? [p.image_path] : []);
  const current = paths[Math.min(imageIndex, Math.max(paths.length - 1, 0))] ?? null;
  const fullImage = useSignedUrl('activity-media', viewer ? current : null);
  const isFull = !!p?.is_full && p.my_response !== 'in';
  const saveResponse = async (kind: 'in' | 'not_in' | null) => {
    if (!p) return;
    if (kind === null && p.my_response === 'in' && !(await confirm({ title: 'Leave this plan?', message: 'The host will see that you are no longer in.', confirmLabel: 'Leave', destructive: true }))) return;
    try {
      await respond.mutateAsync({ postId: p.id, kind, message: kind === 'in' ? message.trim() || null : null });
      await post.refetch();
      toast.success(kind === 'in' ? 'You are in' : kind === 'not_in' ? 'Marked not in' : 'Response removed');
      setMessage('');
    } catch (error) { toast.error(error); }
  };
  return <Screen header={<AppHeader title="Activity" right={p ? <Button title="Share" size="sm" variant="ghost" icon="share-outline"
    onPress={() => void Share.share({ message: `${env.appUrl}/post/${p.id}` }).catch(toast.error)} /> : undefined} />}>
    {post.isLoading ? <LoadingList count={2} /> : post.isError ? toAppError(post.error).code === 'not_found' ?
      <EmptyState title="Activity unavailable" body="This plan may have expired or been removed, or you no longer have access." /> :
      <ErrorState error={post.error} onRetry={() => post.refetch()} /> : p ? <>
        <Card style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar path={p.author.avatar_path} name={p.author.display_name} size={48} />
            <View style={{ flex: 1 }}><Text variant="subheading">{p.author.display_name}</Text>
              <Text variant="caption" color="textSecondary">in {p.server_name}</Text></View>
            <Button title="Profile" size="sm" variant="ghost" onPress={() => router.push({ pathname: '/user/[id]',
              params: { id: p.author.id, serverId: p.server_id, serverName: p.server_name } })} />
          </View>
          <Tag label={p.category} small />
          <Text variant="heading">{p.body}</Text>
          <Text variant="caption" color="textSecondary">{p.capacity ? `${p.in_count}/${p.capacity} in` : `${p.in_count} in`}
            {p.is_full ? ' · Full' : ''}{p.expires_at ? ` · Ends ${new Date(p.expires_at).toLocaleString()}` : ''}</Text>
          {paths.length ? <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            style={{ width: galleryWidth }} onMomentumScrollEnd={(e) => setImageIndex(Math.round(e.nativeEvent.contentOffset.x / galleryWidth))}>
            {paths.map((path) => <GalleryImage key={path} path={path} width={galleryWidth} onOpen={() => setViewer(true)} />)}
          </ScrollView> : null}
          {paths.length > 1 ? <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }} accessibilityLabel={`Photo ${imageIndex + 1} of ${paths.length}`}>
            {paths.map((path, i) => <View key={path} style={{ width: i === imageIndex ? 18 : 7, height: 7, borderRadius: 4,
              backgroundColor: i === imageIndex ? colors.primary : colors.border }} />)}
          </View> : null}
        </Card>
        {p.is_mine ? <Button title={`Responses (${p.in_count} in)`} onPress={() => router.push(`/post/${p.id}/responses`)} /> :
          <Card style={{ gap: 12 }}>
            <Text variant="subheading">Your response</Text>
            {p.my_response === 'in' ? <Button title="Leave this plan" variant="secondary" loading={respond.isPending} onPress={() => void saveResponse(null)} /> : <>
              <TextField label="Message to the host (optional)" value={message} onChangeText={setMessage} maxCount={280} multiline />
              <Button title={isFull ? 'Full' : "I'm in"} disabled={isFull} loading={respond.isPending} onPress={() => void saveResponse('in')} />
            </>}
            <Button title={p.my_response === 'not_in' ? 'Undo not in' : "I'm not in"} variant="ghost" loading={respond.isPending}
              onPress={() => void saveResponse(p.my_response === 'not_in' ? null : 'not_in')} />
          </Card>}
      </> : null}
      <ImageViewer uri={fullImage.data} visible={viewer} onClose={() => setViewer(false)} label="Activity photo" />
    </Screen>;
}
