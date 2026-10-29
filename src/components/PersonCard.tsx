import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar, Button, Card, IconButton, Tag, TagList, Text, VerifiedBadge } from '@/components/ui';
import { useTheme } from '@/theme';
import type { DiscoveryCandidate } from '@/types/domain';

/**
 * A discovery recommendation: limited card + plain-language "why you match" + craving.
 * Only fields the person exposes at "members" level ever reach this component.
 */
export function PersonCard({
  person, onConnect, onDismiss, connecting, serverId, serverName,
}: {
  person: DiscoveryCandidate;
  serverId?: string;
  serverName?: string;
  onConnect: () => void;
  onDismiss: () => void;
  connecting?: boolean;
}) {
  const { colors, radius } = useTheme();
  const subtitle = [person.occupation, person.university].filter(Boolean).join(' · ');
  return (
    <Card accessibilityLabel={`${person.display_name}. ${person.reasons.join('. ')}`} style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <Avatar path={person.avatar_path} name={person.display_name} size={56} available />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading" numberOfLines={1}>
            {person.display_name}
          </Text>
          <Text variant="caption" color="textTertiary">
            @{person.username}
          </Text>
          {subtitle ? (
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <IconButton icon="close" label={`Hide ${person.display_name} for now`} onPress={onDismiss} size={36} />
      </View>

      {person.badges.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {person.badges.map((b) => (
            <VerifiedBadge key={b.label} label={b.label} official={b.is_official} compact />
          ))}
        </View>
      ) : null}

      {person.craving ? (
        <View style={{ backgroundColor: colors.accentSoft, borderRadius: radius.md, padding: 12, flexDirection: 'row', gap: 8 }}>
          <Ionicons name="flash" size={16} color={colors.accentStrong} style={{ marginTop: 2 }} />
          <Text variant="callout" style={{ flex: 1 }}>
            {person.craving}
          </Text>
        </View>
      ) : null}

      {person.reasons.length ? (
        <View style={{ gap: 4 }}>
          {person.reasons.slice(0, 3).map((r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Ionicons name="sparkles" size={14} color={colors.primary} style={{ marginTop: 3 }} />
              <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
                {r}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text variant="callout" color="textTertiary">
          No obvious overlap yet. Still, you&apos;re in the same place right now.
        </Text>
      )}

      {person.shared_tags.length ? (
        <TagList>
          {person.shared_tags.map((tag) => (
            <Tag key={tag} label={tag} tone="brand" small />
          ))}
        </TagList>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button
          title="View profile"
          variant="secondary"
          size="md"
          style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/user/[id]', params: { id: person.user_id, serverId, serverName } })}
        />
        {person.request_state === 'outgoing' ? (
          <Button title="Requested" variant="secondary" icon="time-outline" disabled style={{ flex: 1 }} />
        ) : person.request_state === 'incoming' ? (
          <Button title="Respond" icon="mail-unread-outline" style={{ flex: 1 }} onPress={() => router.push('/requests')} />
        ) : (
          <Button title="Connect" icon="paper-plane" style={{ flex: 1 }} loading={connecting} onPress={onConnect} />
        )}
      </View>
    </Card>
  );
}
