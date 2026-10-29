import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme';
import type { Affiliation } from '@/types/domain';

/**
 * A college / employer the person proved they belong to by entering a code we emailed to that address.
 * Visually distinct from self-reported text: filled tint, shield-check and the verified domain.
 */
export function AffiliationBadge({
  affiliation, onRemove, removing,
}: { affiliation: Pick<Affiliation, 'kind' | 'org_name' | 'domain' | 'org_name_source'>; onRemove?: () => void; removing?: boolean }) {
  const { colors, radius } = useTheme();
  const icon = affiliation.kind === 'college' ? 'school' : 'briefcase';
  return (
    <View
      accessible
      accessibilityLabel={`Verified ${affiliation.kind === 'college' ? 'college' : 'employer'}: ${affiliation.org_name}, email domain ${affiliation.domain}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.successSoft, borderRadius: radius.lg,
        paddingVertical: 10, paddingLeft: 12, paddingRight: onRemove ? 4 : 14, opacity: removing ? 0.5 : 1,
      }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={17} color="#fff" />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Ionicons name="checkmark-circle" size={15} color={colors.success} />
          <Text variant="callout" style={{ flexShrink: 1 }} numberOfLines={2}>
            {affiliation.org_name}
          </Text>
        </View>
        <Text variant="caption" color="textSecondary" numberOfLines={1}>
          {affiliation.org_name_source === 'registry'
            ? `verified @${affiliation.domain}`
            : `email verified @${affiliation.domain} · name self-described`}
        </Text>
      </View>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove verified ${affiliation.org_name}`}
          disabled={removing}
          onPress={onRemove}
          hitSlop={4}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}
