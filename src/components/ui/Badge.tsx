import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

/**
 * A verification badge issued by a Server admin. "Official" Servers (verified by Sniff.in) get the
 * filled seal; others show the issuing Server so the source of the claim is always visible.
 * Self-written profile text (e.g. "University") is never shown with this component.
 */
export function VerifiedBadge({ label, serverName, official, compact }: {
  label: string; serverName?: string | null; official?: boolean; compact?: boolean;
}) {
  const { colors, radius } = useTheme();
  return (
    <View
      accessibilityLabel={`Verified badge: ${label}${serverName ? `, issued by ${serverName}` : ''}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
        backgroundColor: official ? colors.primarySoft : colors.surfaceMuted, borderRadius: radius.pill,
        paddingHorizontal: compact ? 8 : 10, paddingVertical: compact ? 3 : 6,
      }}>
      <Ionicons name={official ? 'shield-checkmark' : 'ribbon-outline'} size={compact ? 12 : 14} color={official ? colors.primary : colors.textSecondary} />
      <Text variant={compact ? 'micro' : 'caption'} style={{ color: official ? colors.primary : colors.textSecondary }} numberOfLines={1}>
        {label}
        {serverName && !compact ? <Text variant="caption" color="textTertiary">{`  ·  ${serverName}`}</Text> : null}
      </Text>
    </View>
  );
}

/** Small "unverified claim" hint for self-reported fields. */
export function SelfReported() {
  return (
    <Text variant="micro" color="textTertiary">
      SELF-REPORTED
    </Text>
  );
}

export function CountBadge({ count }: { count: number }) {
  const { colors } = useTheme();
  if (!count) return null;
  return (
    <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
      <Text variant="micro" style={{ color: colors.onPrimary }}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}
