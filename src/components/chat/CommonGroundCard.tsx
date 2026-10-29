import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Tag, Text } from '@/components/ui';
import { useCommonGround } from '@/features/social/chat-media';
import { useTheme } from '@/theme';
import type { TagKind } from '@/types/domain';

const GROUPS: { kind: TagKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: 'interest', label: 'Interests', icon: 'heart' },
  { kind: 'hobby', label: 'Hobbies', icon: 'color-palette' },
  { kind: 'skill', label: 'Skills', icon: 'flash' },
  { kind: 'career', label: 'Career', icon: 'briefcase' },
  { kind: 'language', label: 'Languages', icon: 'chatbubbles' },
];

/**
 * "What you have in common": shown once at the top of the conversation (not per message).
 * Only uses data the other person's visibility settings already allow (get_icebreaker_context).
 */
export function CommonGroundCard({
  connectionId, serverName, defaultExpanded = true,
}: { connectionId: string; serverName?: string | null; defaultExpanded?: boolean }) {
  const { colors, radius } = useTheme();
  const q = useCommonGround(connectionId);
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (q.isLoading || q.isError || !q.data) return null;
  const c = q.data;
  const tags = c.shared_tags ?? [];
  const server = c.server_name ?? serverName ?? null;
  const count = tags.length + (c.same_university ? 1 : 0) + (c.their_craving ? 1 : 0);

  if (count === 0) {
    return server ? (
      <View style={{ alignItems: 'center', paddingVertical: 10 }}>
        <Text variant="caption" color="textTertiary">You met in {server}</Text>
      </View>
    ) : null;
  }

  const summary = [
    tags.length ? `${tags.length} shared ${tags.length === 1 ? 'interest' : 'interests'}` : null,
    c.same_university ? 'same university' : null,
    c.their_craving ? 'a current craving' : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={{ marginHorizontal: 12, marginVertical: 8, backgroundColor: colors.surfaceBrand, borderRadius: radius.lg, overflow: 'hidden' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`What you have in common with ${c.other_name ?? 'them'}. ${expanded ? 'Collapse' : 'Expand'}`}
        onPress={() => setExpanded((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 48 }}>
        <Ionicons name="sparkles" size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text variant="subheading">What you have in common</Text>
          {!expanded ? <Text variant="caption" color="textSecondary" numberOfLines={1}>{summary}</Text> : null}
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </Pressable>
      {expanded ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>
          {GROUPS.map((g) => {
            const items = tags.filter((t) => t.kind === g.kind);
            if (!items.length) return null;
            return (
              <View key={g.kind} style={{ gap: 6 }}>
                <Text variant="micro" color="textSecondary">{g.label.toUpperCase()}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {items.map((t) => <Tag key={`${t.kind}-${t.name}`} label={t.name} icon={g.icon} tone="brand" small />)}
                </View>
              </View>
            );
          })}
          {c.same_university ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="school" size={16} color={colors.accentStrong} />
              <Text variant="callout" style={{ flex: 1 }}>Both from {c.same_university}</Text>
            </View>
          ) : null}
          {c.their_craving ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Ionicons name="restaurant" size={16} color={colors.festive} style={{ marginTop: 2 }} />
              <Text variant="callout" style={{ flex: 1 }}>
                {c.other_name ?? 'They'} is craving: {c.their_craving}
              </Text>
            </View>
          ) : null}
          {server ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="location" size={16} color={colors.pink} />
              <Text variant="callout" style={{ flex: 1 }}>Met in {server}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
