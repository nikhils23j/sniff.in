import { Image } from 'expo-image';
import { View } from 'react-native';

import { useAvatarUrl } from '@/features/profile/hooks';
import { accents, useTheme } from '@/theme';

import { Text } from './Text';

const TINTS = accents;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/**
 * Private avatars are fetched through a per-viewer signed URL. When the viewer isn't authorised
 * (or there is no photo) we show deterministic initials. Nothing is ever fetched publicly.
 */
export function Avatar({
  path, name, size = 48, available = false,
}: { path?: string | null; name: string; size?: number; available?: boolean }) {
  const { colors } = useTheme();
  const { data: url } = useAvatarUrl(path);
  const tint = TINTS[Math.abs([...name].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % TINTS.length];
  const ring = available ? 3 : 0;

  return (
    <View
      accessibilityLabel={`${name}'s photo`}
      style={{
        width: size + ring * 2, height: size + ring * 2, borderRadius: (size + ring * 2) / 2,
        padding: ring, backgroundColor: available ? colors.accent : 'transparent',
      }}>
      {url ? (
        <Image
          source={{ uri: url, cacheKey: path ?? undefined }}
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceMuted }}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: size * 0.38, lineHeight: size * 0.46, fontFamily: 'PlusJakartaSans_700Bold' }}>
            {initials(name || '?')}
          </Text>
        </View>
      )}
    </View>
  );
}
