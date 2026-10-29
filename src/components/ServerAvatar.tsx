import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import { useSignedUrl } from '@/features/media/hooks';
import { gradients, useTheme } from '@/theme';
import type { ServerCategory } from '@/types/domain';

export const CATEGORY_ICON: Record<ServerCategory, keyof typeof Ionicons.glyphMap> = {
  university: 'school', college: 'school', hall: 'home', club: 'people', company: 'business', office: 'briefcase',
  team: 'git-network', apartment: 'business-outline', alumni: 'ribbon', community: 'people-circle', event: 'calendar',
  concert: 'musical-notes', festival: 'sparkles', conference: 'mic', party: 'wine', restaurant: 'restaurant',
  travel: 'train', city: 'map', other: 'radio',
};

const TILES = [gradients.sunrise, gradients.holi, gradients.peacock, gradients.diya, gradients.brand] as const;

function tileFor(name: string) {
  return TILES[Math.abs([...name].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % TILES.length];
}

/**
 * Square-rounded Server picture (private bucket, per-viewer signed URL). Without a picture (or while it
 * loads / when the viewer can't see it) we show a deterministic colourful gradient tile with the category icon.
 */
export function ServerAvatar({
  name, category, avatarPath, size = 44,
}: { name: string; category: ServerCategory; avatarPath?: string | null; size?: number }) {
  const { colors } = useTheme();
  const { data: url } = useSignedUrl('server-avatars', avatarPath);
  const r = size * 0.3;
  if (avatarPath && url) {
    return (
      <Image
        accessibilityLabel={`${name} picture`}
        source={{ uri: url, cacheKey: avatarPath }}
        style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.surfaceMuted }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View accessibilityLabel={`${name} icon`} style={{ width: size, height: size, borderRadius: r, overflow: 'hidden' }}>
      <LinearGradient
        colors={tileFor(name)}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={CATEGORY_ICON[category] ?? 'radio'} size={size * 0.5} color="#fff" />
      </LinearGradient>
    </View>
  );
}
