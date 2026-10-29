import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { ServerAvatar } from '@/components/ServerAvatar';
import { Card, Tag, Text } from '@/components/ui';
import { useTheme } from '@/theme';
import type { ServerCategory, ServerKind } from '@/types/domain';

export { CATEGORY_ICON } from '@/components/ServerAvatar';

export const KIND_LABEL: Record<ServerKind, string> = { long_term: 'Permanent', short_term: 'Temporary', global: 'City-wide' };

/** Picture-less Server tile (gradient + category icon). Prefer ServerAvatar when a name/picture is known. */
export function ServerIcon({ category, size = 44, name = category }: { category: ServerCategory; size?: number; name?: string }) {
  return <ServerAvatar name={name} category={category} size={size} />;
}

export function ServerCard({
  name, category, kind, avatarPath, parentName, memberCount, isOfficial, endsAt, availableNow, status, role, isLive = true, onPress, onInvitePress, inviteBusy, onSettingsPress, right,
}: {
  name: string;
  category: ServerCategory;
  kind: ServerKind;
  avatarPath?: string | null;
  parentName?: string | null;
  memberCount?: number;
  isOfficial?: boolean;
  endsAt?: string | null;
  availableNow?: string | null;
  status?: 'pending' | 'active' | 'banned' | null;
  role?: 'member' | 'moderator' | 'admin';
  isLive?: boolean;
  onPress?: () => void;
  onInvitePress?: () => void;
  inviteBusy?: boolean;
  onSettingsPress?: () => void;
  right?: React.ReactNode;
}) {
  const { colors, spacing } = useTheme();
  const meta = [
    KIND_LABEL[kind],
    typeof memberCount === 'number' ? `${memberCount} member${memberCount === 1 ? '' : 's'}` : null,
    kind === 'short_term' && endsAt ? (isLive ? `ends ${format(new Date(endsAt), 'd MMM, h:mm a')}` : 'ended') : null,
  ].filter(Boolean).join(' · ');

  return (
    <Card padded={false} style={{ flexDirection: 'row', alignItems: 'stretch', opacity: isLive ? 1 : 0.6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${meta}. Open Server chat`}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14,
          padding: spacing.lg, paddingRight: 8, opacity: pressed ? 0.8 : 1 })}>
        <ServerAvatar name={name} category={category} avatarPath={avatarPath} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </Text>
            {isOfficial ? <Ionicons name="shield-checkmark" size={15} color={colors.primary} accessibilityLabel="Verified organisation" /> : null}
          </View>
          {parentName ? (
            <Text variant="caption" color="textTertiary" numberOfLines={1}>
              in {parentName}
            </Text>
          ) : null}
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {meta}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            {status === 'pending' ? <Tag label="Awaiting approval" tone="warning" small /> : null}
            {status === 'banned' ? <Tag label="Removed" tone="warning" small /> : null}
            {role && role !== 'member' ? <Tag label={role === 'admin' ? 'Admin' : 'Moderator'} tone="brand" small /> : null}
            {availableNow && availableNow !== '0' && isLive ? <Tag label={`${availableNow} ${availableNow === '1' ? 'person' : 'people'} available now`} tone="accent" icon="radio" small /> : null}
          </View>
        </View>
      </Pressable>
      {onInvitePress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Copy invite link for ${name}`}
          accessibilityState={{ busy: !!inviteBusy }} disabled={inviteBusy}
          onPress={onInvitePress}
          style={({ pressed }) => ({ width: 48, alignItems: 'center', justifyContent: 'center',
            opacity: pressed ? 0.7 : 1 })}>
          {inviteBusy ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="copy-outline" size={23} color={colors.textSecondary} />}
        </Pressable>
      ) : null}
      {onSettingsPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Settings for ${name}`}
          onPress={onSettingsPress}
          style={({ pressed }) => ({ width: 56, alignItems: 'center', justifyContent: 'center',
            paddingRight: spacing.lg, opacity: pressed ? 0.7 : 1 })}>
          <Ionicons name="settings-outline" size={23} color={colors.textSecondary} />
        </Pressable>
      ) : (
        <View style={{ paddingRight: spacing.lg, justifyContent: 'center' }}>
          {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null)}
        </View>
      )}
    </Card>
  );
}
