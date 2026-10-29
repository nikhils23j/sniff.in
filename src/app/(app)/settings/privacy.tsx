import { router } from 'expo-router';
import { View } from 'react-native';

import {
  AppHeader, Banner, Card, ErrorState, ListGroup, ListRow, LoadingList, Screen, SectionHeader, SegmentedControl, SwitchRow, Text, toast,
} from '@/components/ui';
import { refreshProfileEmbedding } from '@/features/profile/embedding';
import { useMySettings, useUpdateSettings } from '@/features/profile/hooks';
import type { FieldVisibility, UserSettings } from '@/types/domain';

type VisKey =
  | 'bio_visibility' | 'education_visibility' | 'occupation_visibility' | 'career_goals_visibility' | 'tags_visibility'
  | 'socials_visibility' | 'craving_visibility' | 'badges_visibility' | 'endorsements_visibility'
  | 'height_visibility' | 'hometown_visibility' | 'relationship_visibility' | 'lifestyle_visibility';

/** `covers` mirrors app_private.profile_json_render: every profile field each setting controls. */
const FIELDS: { key: VisKey; title: string; covers: string[] }[] = [
  { key: 'bio_visibility', title: 'Bio & conversation', covers: ['Bio', 'Conversation interests', 'Conversation starters (prompts)', 'Professional bio'] },
  { key: 'education_visibility', title: 'Education', covers: ['Education level', 'School, college or alma mater'] },
  { key: 'occupation_visibility', title: 'Occupation', covers: ['Job title', 'Workplace', 'Work experience'] },
  { key: 'height_visibility', title: 'Height', covers: ['Height'] },
  { key: 'hometown_visibility', title: 'Hometown', covers: ['Hometown'] },
  { key: 'relationship_visibility', title: 'Relationship information', covers: ['Relationship status'] },
  { key: 'career_goals_visibility', title: 'Career goals', covers: ['Career goals', 'Professional interests'] },
  { key: 'tags_visibility', title: 'Interests & skills', covers: ['Interests', 'Hobbies', 'Skills', 'Languages', 'Career tags'] },
  { key: 'socials_visibility', title: 'Links', covers: ['Website', 'Instagram', 'LinkedIn', 'Spotify'] },
  { key: 'craving_visibility', title: 'Current craving', covers: ['What you are looking for right now'] },
  { key: 'badges_visibility', title: 'Verified badges', covers: ['Verified college or work email', 'Badges granted by Server admins'] },
  { key: 'endorsements_visibility', title: 'Endorsements', covers: ['Endorsements you approved'] },
];

const LEVELS: { value: FieldVisibility; label: string }[] = [
  { value: 'members', label: 'Members' },
  { value: 'connections', label: 'Connections' },
  { value: 'only_me', label: 'Only me' },
];

const LEVEL_TEXT: Record<FieldVisibility, string> = {
  members: 'Anyone who can open your profile.',
  connections: 'Only people you have connected with.',
  only_me: 'Nobody else.',
};
const AUDIENCES = [
  { value: 'personal' as const, label: 'Personal' },
  { value: 'professional' as const, label: 'Professional' },
  { value: 'both' as const, label: 'Both' },
];

export default function PrivacySettingsScreen() {
  const settings = useMySettings();
  const update = useUpdateSettings();

  const change = (patch: Partial<UserSettings>) => update.mutate(patch, { onError: toast.error });

  const toggleAi = (on: boolean) => {
    update.mutate(
      { ai_features_consent: on },
      {
        onSuccess: () => {
          // Turning it off asks the Edge Function to delete the stored vector. Turning on builds one.
          void refreshProfileEmbedding();
          toast.success(on ? 'AI personalisation is on' : 'AI personalisation is off. Your stored vector is being deleted.');
        },
        onError: toast.error,
      },
    );
  };

  let body: React.ReactNode;
  if (settings.isLoading) body = <LoadingList count={3} />;
  else if (settings.isError || !settings.data) body = <ErrorState error={settings.error ?? new Error('unknown')} onRetry={() => { settings.refetch(); }} />;
  else {
    const s = settings.data;
    body = (
      <>
        <SectionHeader title="Profile audiences" />
        <Card style={{ gap: 10 }}>
          <Text variant="subheading">Connected users</Text>
          <Text variant="caption" color="textSecondary">What people you have accepted can see.</Text>
          <SegmentedControl options={AUDIENCES} value={s.connected_audience} onChange={(v) => change({ connected_audience: v })} />
        </Card>
        <Card style={{ gap: 10 }}>
          <Text variant="subheading">Unconnected users</Text>
          <Text variant="caption" color="textSecondary">What other people can see before connecting.</Text>
          <SegmentedControl options={AUDIENCES} value={s.unconnected_audience} onChange={(v) => change({ unconnected_audience: v })} />
        </Card>
        <Text variant="caption" color="textSecondary">Personal includes your bio, interests, prompts and photos. Professional includes education, work and career information. Name, main photo and mutual Server badges remain visible.</Text>
        <SectionHeader title="Fine-tune individual fields" />
        {FIELDS.map((f) => (
          <Card key={f.key} style={{ gap: 12 }}>
            <View style={{ gap: 2 }}>
              <Text variant="subheading">{f.title}</Text>
              <Text variant="caption" color="textSecondary">
                Controls: {f.covers.join(', ')}.
              </Text>
            </View>
            <SegmentedControl options={LEVELS} value={s[f.key]} onChange={(v) => change({ [f.key]: v })} />
            <Text variant="caption" color="textTertiary" accessibilityLiveRegion="polite">
              Visible to: {LEVEL_TEXT[s[f.key]]}
            </Text>
          </Card>
        ))}

        <SectionHeader title="Location" />
        <ListGroup>
          <ListRow
            icon="flame-outline"
            title="Hot Map"
            subtitle={`${s.hot_map_opt_in ? 'On' : 'Off'}. Opt-in only. Your location is rounded to about 1 km and counted only while you're Available. Others only see ranges like "5–9 people", for areas with at least 3, and your spot is deleted 30 minutes after your last update.`}
            onPress={() => router.push('/hot-map')}
          />
        </ListGroup>

        <SectionHeader title="AI features" />
        <ListGroup>
          <SwitchRow
            icon="sparkles-outline"
            title="Personalise matches with AI"
            subtitle="Off by default. When on, visible profile details can improve matching. If both people opt in, shared interests can also generate chat starters and search for a sourced current topic. Chat messages are never sent for suggestions."
            value={s.ai_features_consent}
            onValueChange={toggleAi}
          />
        </ListGroup>
        <Text variant="caption" color="textTertiary">
          Turning this off deletes your stored vector. Matching then uses only the deterministic ranking.
        </Text>
      </>
    );
  }

  return (
    <Screen header={<AppHeader title="Privacy & visibility" />} edges={['top', 'bottom']}>
      <Banner
        tone="info"
        icon="eye-off"
        title="Choose what each audience sees"
        body="Set Personal, Professional or Both for connected and unconnected people. Individual field settings below can further restrict what is shown. Your name and main photo remain visible."
        action={{ label: 'Preview your profile', onPress: () => router.push('/profile/preview') }}
      />
      {body}
    </Screen>
  );
}
