import Ionicons from '@expo/vector-icons/Ionicons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { chatApi } from '@/features/social/api';
import { toAppError } from '@/lib/errors';
import { useTheme } from '@/theme';
import type { Gif } from '@/types/domain';

/** Search + trending GIFs via the gif-search Edge Function (GIPHY, PG-rated). */
export function GifPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (gif: Gif) => void }) {
  const { colors, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 400);
    return () => clearTimeout(t);
  }, [text]);

  const q = useInfiniteQuery({
    queryKey: ['gifs', query],
    queryFn: ({ pageParam }) => chatApi.searchGifs(query, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.length, 0);
      return last.length === 0 || loaded >= 200 ? undefined : loaded;
    },
    enabled: visible,
    staleTime: 5 * 60_000,
    retry: (count, e) => toAppError(e).code !== 'gifs_not_configured' && count < 1,
  });
  const gifs = q.data?.pages.flat() ?? [];
  const code = q.isError ? toAppError(q.error).code : null;

  const close = () => {
    setText('');
    setQuery('');
    onClose();
  };

  let body: React.ReactNode;
  if (code === 'gifs_not_configured') {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 }}>
        <Ionicons name="happy-outline" size={44} color={colors.textTertiary} />
        <Text variant="heading" align="center">GIFs aren&apos;t available yet</Text>
        <Text variant="callout" color="textSecondary" align="center">
          We&apos;re still setting this up. Stickers and photos work in the meantime.
        </Text>
      </View>
    );
  } else if (q.isError && gifs.length === 0) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
        <Text variant="callout" color="textSecondary" align="center">{toAppError(q.error).message}</Text>
        <Button title="Try again" variant="secondary" size="sm" onPress={() => { q.refetch(); }} />
      </View>
    );
  } else if (q.isLoading || (q.isFetching && gifs.length === 0)) {
    body = <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  } else if (gifs.length === 0) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text variant="callout" color="textSecondary" align="center">No GIFs found for &ldquo;{query}&rdquo;. Try another word.</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={gifs}
        numColumns={2}
        keyExtractor={(g, i) => `${g.id}-${i}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}
        columnWrapperStyle={{ gap: 8 }}
        onEndReachedThreshold={0.5}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 12 }} color={colors.primary} /> : undefined}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Send GIF: ${item.title || 'GIF'}`}
            onPress={() => {
              close();
              setTimeout(() => onPick(item), 200);
            }}
            style={({ pressed }) => ({ flex: 1, marginBottom: 8, opacity: pressed ? 0.75 : 1 })}>
            <Image
              source={{ uri: item.preview_url }}
              autoplay
              contentFit="cover"
              style={{ width: '100%', aspectRatio: item.width > 0 && item.height > 0 ? item.width / item.height : 1, borderRadius: radius.md, backgroundColor: colors.surfaceMuted }}
            />
          </Pressable>
        )}
      />
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable accessibilityLabel="Close GIF picker" style={{ flex: 1, backgroundColor: colors.overlay }} onPress={close} />
      <View
        accessibilityViewIsModal
        style={{ height: '78%', backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingBottom: insets.bottom + 8 }}>
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 10 }} />
        {code === 'gifs_not_configured' ? null : (
          <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.pill, paddingHorizontal: 14 }}>
              <Ionicons name="search" size={18} color={colors.textTertiary} />
              <TextInput
                accessibilityLabel="Search GIFs"
                placeholder="Search GIFs"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                value={text}
                onChangeText={setText}
                autoCorrect={false}
                returnKeyType="search"
                style={{ ...typography.body, flex: 1, color: colors.text, minHeight: 44 }}
              />
              {text ? (
                <Pressable accessibilityLabel="Clear search" hitSlop={10} onPress={() => setText('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                </Pressable>
              ) : null}
            </View>
            {!query ? <Text variant="micro" color="textTertiary" style={{ marginTop: 8, marginLeft: 6 }}>TRENDING</Text> : null}
          </View>
        )}
        <View style={{ flex: 1 }}>{body}</View>
        {code === 'gifs_not_configured' ? null : <Text variant="micro" color="textTertiary" align="center" style={{ paddingTop: 4 }}>Powered by GIPHY</Text>}
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
