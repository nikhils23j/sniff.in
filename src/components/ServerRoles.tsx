import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/** What admins and moderators can do (§4.5). The backend enforces the same rules. */
export function RolesExplainer() {
  const { colors } = useTheme();
  const row = (icon: keyof typeof Ionicons.glyphMap, title: string, body: string) => (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={colors.primary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="callout">{title}</Text>
        <Text variant="caption" color="textSecondary">{body}</Text>
      </View>
    </View>
  );
  return (
    <Card tone="muted" style={{ gap: 10 }}>
      <Text variant="subheading">Roles</Text>
      {row('shield-checkmark-outline', 'Admin',
        'Adds and removes members, changes settings, manages the Server’s lifecycle, appoints moderators and assigns badges.')}
      {row('ribbon-outline', 'Moderator', 'Assigns this Server’s badges and helps with limited moderation such as reviewing reports. Cannot remove members.')}
    </Card>
  );
}
