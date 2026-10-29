import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileBody } from '@/components/ProfileBody';
import { validSocials } from '@/components/SocialLinks';
import { Banner, Button, ErrorState, IconButton, LoadingList, Text } from '@/components/ui';
import { useMySettings, usePreviewMyProfile } from '@/features/profile/hooks';
import { useTheme } from '@/theme';
import type { FieldVisibility, MyProfile, ProfileView, UserSettings } from '@/types/domain';

/** Current (possibly unsaved) values from the Edit form. */
export type PreviewValues = {
  display_name?: string;
  bio?: string;
  social_preferences?: string;
  professional_bio?: string;
  work_experience?: string;
  professional_interests?: string;
  university?: string;
  occupation?: string;
  career_goals?: string;
  website_url?: string;
  instagram_handle?: string;
  linkedin_url?: string;
};

type VisKey = keyof Pick<UserSettings,
  'bio_visibility' | 'education_visibility' | 'occupation_visibility' | 'career_goals_visibility' | 'socials_visibility'>;

/** Mirrors app_private.profile_json_render: which privacy setting governs each text field. */
const FIELD_SETTING: Record<Exclude<keyof PreviewValues, 'display_name' | 'website_url' | 'instagram_handle' | 'linkedin_url'>, VisKey> = {
  bio: 'bio_visibility',
  social_preferences: 'bio_visibility',
  professional_bio: 'bio_visibility',
  university: 'education_visibility',
  occupation: 'occupation_visibility',
  work_experience: 'occupation_visibility',
  career_goals: 'career_goals_visibility',
  professional_interests: 'career_goals_visibility',
};

const DEFAULT_LEVEL: Record<VisKey, FieldVisibility> = {
  bio_visibility: 'members',
  education_visibility: 'members',
  occupation_visibility: 'members',
  career_goals_visibility: 'members',
  socials_visibility: 'connections',
};

const text = (v: string | undefined | null) => (v ?? '').trim() || null;

/**
 * The saved member view (preview_my_profile) with the Edit form's unsaved text merged in, following the same
 * per-field privacy rules the server applies. Photos, prompts, tags, badges, craving and endorsements come from
 * the saved profile because they are edited elsewhere.
 */
export function mergePreview(
  base: ProfileView,
  me: Pick<MyProfile, 'display_name' | 'avatar_path' | 'username' | 'spotify_url'>,
  values: PreviewValues,
  settings: UserSettings | undefined,
): ProfileView {
  const level = (k: VisKey): FieldVisibility => settings?.[k] ?? DEFAULT_LEVEL[k];
  const shown = (k: VisKey) => level(k) === 'members';
  const out: ProfileView = { ...base, display_name: text(values.display_name) ?? me.display_name, avatar_path: me.avatar_path, username: me.username };
  for (const [field, key] of Object.entries(FIELD_SETTING) as [keyof typeof FIELD_SETTING, VisKey][]) {
    out[field] = shown(key) ? text(values[field]) : null;
  }
  const links = {
    website_url: text(values.website_url),
    instagram_handle: text(values.instagram_handle)?.replace(/^@/, '') ?? null,
    linkedin_url: text(values.linkedin_url),
    spotify_url: me.spotify_url ?? null,
  };
  const socialsShown = shown('socials_visibility');
  out.website_url = socialsShown ? links.website_url : null;
  out.instagram_handle = socialsShown ? links.instagram_handle : null;
  out.linkedin_url = socialsShown ? links.linkedin_url : null;
  out.spotify_url = socialsShown ? links.spotify_url : null;
  out.socials_hidden = !socialsShown && validSocials(links).length > 0;
  return out;
}

/**
 * Full-screen preview from the Edit screen: exactly the universal profile layout, with unsaved edits applied.
 */
export function ProfilePreview({
  visible, onClose, onSave, saving, canSave, me, values,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
  me: Pick<MyProfile, 'display_name' | 'avatar_path' | 'username' | 'spotify_url'>;
  values: PreviewValues;
}) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const base = usePreviewMyProfile();
  const settings = useMySettings();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.background, paddingTop: Math.max(insets.top, 12) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: 52, gap: 4 }}>
          <IconButton icon="close" label="Close preview" onPress={onClose} />
          <View style={{ flex: 1 }}>
            <Text variant="heading" accessibilityRole="header">Preview</Text>
            <Text variant="caption" color="textSecondary">Includes your unsaved changes</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: 32, gap: spacing.lg }}>
          <Banner tone="info" icon="eye-outline" body="This is how members see your profile. Fields set to Connections or Only me are hidden." />
          {base.isLoading ? (
            <LoadingList count={3} />
          ) : base.isError || !base.data ? (
            <ErrorState error={base.error ?? new Error('unknown')} onRetry={() => { void base.refetch(); }} />
          ) : (
            <ProfileBody profile={mergePreview(base.data, me, values, settings.data)} interactive={false} />
          )}
        </ScrollView>

        <View style={{ paddingHorizontal: spacing.xl, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16), gap: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
          <Button title={canSave ? 'Save changes' : 'No unsaved changes'} size="lg" fullWidth icon="checkmark" loading={saving} disabled={!canSave} onPress={onSave} />
          <Button title="Keep editing" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
