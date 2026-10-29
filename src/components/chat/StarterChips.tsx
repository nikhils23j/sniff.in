import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, View } from 'react-native';

import { Skeleton, Text, toast } from '@/components/ui';
import { useRefreshIcebreakers, useStartersDismissed } from '@/features/social/chat-media';
import { useIcebreakers } from '@/features/social/hooks';
import { useTheme } from '@/theme';

/**
 * Conversation starters for brand-new chats. Tapping one sends it immediately.
 * Refresh asks for a new set; Dismiss hides them for this conversation permanently.
 */
export function StarterChips({
  connectionId, conversationId, onPick, sending,
}: { connectionId: string; conversationId: string; onPick: (text: string) => void; sending: boolean }) {
  const { colors, radius } = useTheme();
  const { loaded, dismissed, dismiss } = useStartersDismissed(conversationId);
  const q = useIcebreakers(loaded && !dismissed ? connectionId : undefined);
  const refresh = useRefreshIcebreakers(connectionId);

  if (!loaded || dismissed) return null;
  const suggestions = q.data?.suggestions ?? [];
  if (!q.isLoading && !q.isFetching && suggestions.length === 0) return null;

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="sparkles" size={14} color={colors.primary} />
        <Text variant="micro" color="textSecondary" style={{ flex: 1 }}>
          {q.data?.current ? 'CURRENT TOPIC · SUGGESTED FROM WHAT YOU SHARE' : q.data?.source === 'ai' ? 'AI SUGGESTIONS' : 'SUGGESTED FROM WHAT YOU SHARE'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh suggestions"
          disabled={refresh.isPending}
          hitSlop={8}
          onPress={() => refresh.mutate(undefined, { onError: (e) => toast.error(e) })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 6, opacity: refresh.isPending ? 0.5 : 1 }}>
          <Ionicons name="refresh" size={14} color={colors.primary} />
          <Text variant="caption" style={{ color: colors.primary }}>Refresh</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss suggestions"
          hitSlop={8}
          onPress={dismiss}
          style={{ minHeight: 40, paddingHorizontal: 6, justifyContent: 'center' }}>
          <Text variant="caption" color="textSecondary">Dismiss</Text>
        </Pressable>
      </View>
      {q.data?.current ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Read source: ${q.data.current.source_title}`}
          onPress={() => Linking.openURL(q.data!.current!.source_url).catch((e) => toast.error(e))}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 32 }}>
          <Ionicons name="open-outline" size={13} color={colors.primary} />
          <Text variant="micro" style={{ color: colors.primary }} numberOfLines={1}>
            Source: {q.data.current.source_title}
          </Text>
        </Pressable>
      ) : null}
      {q.isLoading || refresh.isPending ? (
        <View style={{ gap: 6 }}>
          <Skeleton height={36} radius={radius.lg} />
          <Skeleton height={36} radius={radius.lg} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {suggestions.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="button"
              accessibilityLabel={`Send message: ${s}`}
              accessibilityState={{ disabled: sending }}
              disabled={sending}
              onPress={() => onPick(s)}
              style={({ pressed }) => ({
                maxWidth: '100%', backgroundColor: pressed ? colors.primarySoft : colors.surface, borderRadius: radius.lg,
                borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: 'center',
                opacity: sending ? 0.5 : 1,
              })}>
              <Text variant="caption" numberOfLines={2}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
