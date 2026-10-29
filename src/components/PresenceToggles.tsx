import { Switch, View } from 'react-native';

import { Skeleton, Text, toast } from '@/components/ui';
import { usePresence, useSetAvailable } from '@/features/social/hooks';
import { useTheme } from '@/theme';

/** Home uses one compact presence control. Open to Talk belongs to temporary Servers. */
export function CompactAvailability() {
  const t = useTheme(); const presence = usePresence(); const setAvailable = useSetAvailable();
  if (!presence.data) return <Skeleton width={112} height={32} radius={16} />;
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, paddingHorizontal: 10,
    borderRadius: t.radius.pill, backgroundColor: presence.data.is_available ? t.colors.primarySoft : t.colors.surfaceMuted }}>
    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: presence.data.is_available ? t.colors.success : t.colors.textTertiary }} />
    <Text variant="micro" style={{ fontWeight: '700' }}>Available</Text>
    <Switch style={{ alignSelf: 'center', marginVertical: 0 }} accessibilityLabel="Available to people in my Servers" value={presence.data.is_available} disabled={setAvailable.isPending}
      onValueChange={(value) => setAvailable.mutate(value, { onError: toast.error })} trackColor={{ false: t.colors.borderStrong, true: t.colors.primary }} />
  </View>;
}
