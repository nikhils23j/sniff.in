import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ChoiceGrid } from '@/components/OnboardingChoices';

import {
  AppHeader, Banner, Button, ErrorState, ListGroup, ListRow, LoadingList, RadioGroup, Screen, SectionHeader, Text, toast,
} from '@/components/ui';
import { useMyPrivate, useUpdateSafety } from '@/features/profile/hooks';
import { toAppError } from '@/lib/errors';
import { useTheme } from '@/theme';
import type { DiscoveryAudience, Gender } from '@/types/domain';

type GenderChoice = Gender | 'none';

const GENDER_OPTIONS: { value: GenderChoice; label: string }[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'none', label: 'Prefer not to say' },
];

const SAFETY_POINTS = [
  { icon: 'radio-outline', text: 'Available is a switch on Discover. Turn it off and new people in your Servers can no longer see you.' },
  { icon: 'navigate-outline', text: 'No background tracking. Location is used only when you choose: to share a spot in a chat, or (if you opt in) the Hot Map, rounded to about 1 km.' },
  { icon: 'lock-closed-outline', text: 'Social links and private details stay hidden until both of you accept.' },
  { icon: 'flag-outline', text: 'Block or report anyone, any time. Reports are reviewed by people.' },
  { icon: 'timer-outline', text: 'Event chats are ephemeral and disappear when the event ends unless you both save the connection.' },
] as const;

export default function SafetySettingsScreen() {
  const priv = useMyPrivate();
  const update = useUpdateSafety();
  const { colors } = useTheme();
  const [gender, setGender] = useState<Gender | null>(null);
  const [audience, setAudience] = useState<DiscoveryAudience>('everyone');
  const [talkTo, setTalkTo] = useState<Gender[]>([]);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded || !priv.data) return;
    setGender(priv.data.gender);
    setAudience(priv.data.discovery_audience);
    setTalkTo(priv.data.talk_to_genders);
    setSeeded(true);
  }, [priv.data, seeded]);

  if (priv.isLoading || (!seeded && !priv.isError)) {
    return (
      <Screen header={<AppHeader title="Safety & discovery" />}>
        <LoadingList count={2} />
      </Screen>
    );
  }
  if (priv.isError || !priv.data) {
    return (
      <Screen header={<AppHeader title="Safety & discovery" />}>
        <ErrorState error={priv.error ?? new Error('unknown')} onRetry={() => { priv.refetch(); }} />
      </Screen>
    );
  }

  const dirty = gender !== priv.data.gender || audience !== priv.data.discovery_audience || talkTo.join(',') !== priv.data.talk_to_genders.join(',');
  const sameDisabled = !gender;

  const pickGender = (v: GenderChoice) => {
    const g = v === 'none' ? null : v;
    setGender(g);
    if (!g && audience === 'same_gender') {
      setAudience('everyone');
      toast.info('Without a gender, the same-gender filter is switched off.');
    }
  };

  const save = () => {
    if (!talkTo.length) { toast.error('Choose at least one group you want to talk to'); return; }
    if (audience === 'same_gender' && !gender) {
      toast.error('Choose your gender to use the same-gender safety filter');
      return;
    }
    update.mutate(
      { gender, audience, talkToGenders: talkTo },
      {
        onSuccess: () => toast.success('Safety settings saved'),
        onError: (e) => {
          if (toAppError(e).code === 'gender_required') toast.error('Choose your gender to use the same-gender safety filter');
          else toast.error(e);
        },
      },
    );
  };

  return (
    <Screen
      header={<AppHeader title="Safety & discovery" />}
      edges={['top', 'bottom']}
      footer={<Button title="Save" size="lg" fullWidth loading={update.isPending} disabled={!dirty} onPress={save} />}>
      <Text variant="callout" color="textSecondary">
        Choose who you would like to meet. This is optional and entirely your call.
      </Text>

      <View style={{ gap: 12 }}>
        <Text variant="heading" accessibilityRole="header">Who do you want to talk to?</Text>
        <ChoiceGrid multi options={[{ value: 'woman', label: 'Women' }, { value: 'man', label: 'Men' }, { value: 'nonbinary', label: 'Non-binary people' }]}
          value={talkTo} onChange={(value) => setTalkTo(value as Gender[])} />
      </View>

      <View style={{ gap: 12 }}>
        <Text variant="heading" accessibilityRole="header">
          Gender (optional)
        </Text>
        <RadioGroup options={GENDER_OPTIONS} value={gender ?? 'none'} onChange={pickGender} />
      </View>

      <View style={{ gap: 12 }}>
        <Text variant="heading" accessibilityRole="header">
          Who can you meet?
        </Text>
        <ListGroup>
          {(
            [
              {
                value: 'same_gender',
                label: 'Same gender only',
                description: sameDisabled ? 'Choose a gender above to use this option.' : 'You will only meet people of the same gender.',
              },
              { value: 'everyone', label: 'Everyone', description: 'You can meet anyone who is available.' },
            ] as { value: DiscoveryAudience; label: string; description: string }[]
          ).map((o) => {
            const disabled = o.value === 'same_gender' && sameDisabled;
            const selected = audience === o.value;
            return (
              <Pressable
                key={o.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                onPress={() => setAudience(o.value)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, opacity: disabled ? 0.5 : 1,
                  backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
                })}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="callout">{o.label}</Text>
                  <Text variant="caption" color="textSecondary">
                    {o.description}
                  </Text>
                </View>
                <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.textTertiary} />
              </Pressable>
            );
          })}
        </ListGroup>
      </View>

      <Banner
        tone="info"
        icon="shield-checkmark"
        title="How this works"
        body="Your gender is never shown on your profile, never inferred, and used only for this filter. Same gender works both ways: you only see people who can also see you."
      />

      <SectionHeader title="How Sniff.in keeps you safe" />
      <View style={{ gap: 12 }}>
        {SAFETY_POINTS.map((p) => (
          <View key={p.text} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <Ionicons name={p.icon} size={20} color={colors.primary} style={{ marginTop: 1 }} />
            <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
              {p.text}
            </Text>
          </View>
        ))}
      </View>

      <ListGroup>
        <ListRow icon="ban-outline" title="Blocked people" subtitle="See and manage who you blocked" onPress={() => router.push('/settings/blocked')} />
      </ListGroup>
    </Screen>
  );
}
