import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Text, toast } from '@/components/ui';
import { httpsUrl, igHandle, linkedinUrl, openSocial, spotifyUrl, type SocialKind } from '@/features/profile/links';
import { palette, useTheme } from '@/theme';

// Third-party brand colours (not theme tokens on purpose).
const BRAND: Record<SocialKind, { bg: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  instagram: { bg: '#E4405F', icon: 'logo-instagram', label: 'Instagram' },
  linkedin: { bg: '#0A66C2', icon: 'logo-linkedin', label: 'LinkedIn' },
  spotify: { bg: '#1DB954', icon: 'musical-notes', label: 'Spotify' },
  website: { bg: palette.peacock500, icon: 'globe-outline', label: 'Website' },
};

export type SocialLinkValues = {
  instagram_handle?: string | null;
  linkedin_url?: string | null;
  spotify_url?: string | null;
  website_url?: string | null;
};

/** Only well-formed values survive; anything else is silently dropped (never opened). */
export function validSocials(v: SocialLinkValues): { kind: SocialKind; value: string }[] {
  const out: { kind: SocialKind; value: string }[] = [];
  const ig = igHandle(v.instagram_handle);
  if (ig) out.push({ kind: 'instagram', value: ig });
  const li = linkedinUrl(v.linkedin_url);
  if (li) out.push({ kind: 'linkedin', value: li });
  const sp = spotifyUrl(v.spotify_url);
  if (sp) out.push({ kind: 'spotify', value: sp });
  const web = httpsUrl(v.website_url);
  if (web) out.push({ kind: 'website', value: web });
  return out;
}

/** Brand-coloured icon buttons. `interactive={false}` renders the same look without opening anything (previews). */
export function SocialLinks({ links, interactive = true }: { links: { kind: SocialKind; value: string }[]; interactive?: boolean }) {
  const { colors } = useTheme();
  if (!links.length) return null;
  const open = async (l: { kind: SocialKind; value: string }) => {
    const ok = await openSocial(l.kind, l.value);
    if (!ok) toast.error("Couldn't open that link.");
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      {links.map((l) => {
        const b = BRAND[l.kind];
        return (
          <Pressable
            key={l.kind}
            accessibilityRole={interactive ? 'link' : 'image'}
            accessibilityLabel={interactive ? `Open ${b.label}` : b.label}
            disabled={!interactive}
            onPress={() => { void open(l); }}
            style={({ pressed }) => ({ alignItems: 'center', gap: 6, minWidth: 56, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            <View
              style={{
                width: 52, height: 52, borderRadius: 18, backgroundColor: b.bg, alignItems: 'center', justifyContent: 'center',
                shadowColor: b.bg, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
              }}>
              <Ionicons name={b.icon} size={26} color="#fff" />
            </View>
            <Text variant="micro" style={{ color: colors.textSecondary }}>
              {b.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
