import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { TagPicker } from '@/components/TagPicker';
import { AppHeader, Banner, Button, Card, ErrorState, LoadingList, Screen, Tag, Text, toast } from '@/components/ui';
import { refreshProfileEmbedding } from '@/features/profile/embedding';
import { useMySettings, useMyTags, useSetTags } from '@/features/profile/hooks';
import type { FieldVisibility, TagKind } from '@/types/domain';

const MAX = 15;

const SECTIONS: { kind: TagKind; title: string; description: string; starters: string[]; placeholder: string }[] = [
  {
    kind: 'interest', title: 'Interests', description: 'Topics you love talking about.', placeholder: 'Add an interest',
    starters: ['Machine Learning', 'Startups', 'Music', 'Photography', 'Design', 'Finance', 'Politics', 'Cinema', 'Books', 'Travel', 'Fitness', 'Gaming'],
  },
  {
    kind: 'hobby', title: 'Hobbies', description: 'Things you do for fun, great for finding a partner.', placeholder: 'Add a hobby',
    starters: ['Badminton', 'Cricket', 'Football', 'Running', 'Chess', 'Cooking', 'Trekking', 'Dance', 'Guitar'],
  },
  {
    kind: 'skill', title: 'Skills', description: 'What you are good at.', placeholder: 'Add a skill',
    starters: ['Python', 'React', 'UI/UX Design', 'Product Management', 'Public Speaking', 'Data Analysis'],
  },
  {
    kind: 'language', title: 'Languages', description: 'Languages you can chat in.', placeholder: 'Add a language',
    starters: ['English', 'Hindi', 'Kannada', 'Tamil', 'Telugu', 'Bengali', 'Marathi'],
  },
  {
    kind: 'career', title: 'Career goals', description: 'Where you are headed.', placeholder: 'Add a career goal',
    starters: ['Software Engineering', 'Research', 'Entrepreneurship', 'Consulting', 'Product', 'Design'],
  },
];

type Selection = Record<TagKind, string[]>;
const empty = (): Selection => ({ interest: [], hobby: [], skill: [], language: [], career: [] });

const sameSet = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const s = new Set(a.map((x) => x.trim().toLowerCase()));
  return b.every((x) => s.has(x.trim().toLowerCase()));
};

const VIS_LABEL: Record<FieldVisibility, string> = { members: 'Members', connections: 'Connections', only_me: 'Only me' };

export default function InterestsScreen() {
  const mine = useMyTags();
  const settings = useMySettings();
  const setTags = useSetTags();
  const [sel, setSel] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Selection>(empty());

  // Seed from the server once; after a save the "saved" snapshot is updated locally.
  useEffect(() => {
    if (sel || !mine.data) return;
    const next = empty();
    for (const tag of mine.data) next[tag.kind].push(tag.name);
    setSaved({ interest: [...next.interest], hobby: [...next.hobby], skill: [...next.skill], language: [...next.language], career: [...next.career] });
    setSel(next);
  }, [mine.data, sel]);

  const dirtyKinds = useMemo(
    () => (sel ? SECTIONS.filter((s) => !sameSet(sel[s.kind], saved[s.kind])).map((s) => s.kind) : []),
    [sel, saved],
  );

  if (mine.isLoading || (!sel && !mine.isError)) {
    return (
      <Screen header={<AppHeader title="Interests & skills" />}>
        <LoadingList count={3} />
      </Screen>
    );
  }
  if (mine.isError || !sel) {
    return (
      <Screen header={<AppHeader title="Interests & skills" />}>
        <ErrorState error={mine.error ?? new Error('unknown')} onRetry={() => { mine.refetch(); }} />
      </Screen>
    );
  }

  const save = async (kinds: TagKind[]) => {
    setSaving(true);
    try {
      for (const kind of kinds) {
        await setTags.mutateAsync({ kind, names: sel[kind].slice(0, MAX) });
        setSaved((cur) => ({ ...cur, [kind]: [...sel[kind]] }));
      }
      if (settings.data?.ai_features_consent) void refreshProfileEmbedding();
      toast.success('Saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const level = settings.data?.tags_visibility;

  return (
    <Screen
      header={<AppHeader title="Interests & skills" />}
      edges={['top', 'bottom']}
      footer={
        <View style={{ gap: 8 }}>
          <Button
            title={dirtyKinds.length ? `Save changes (${dirtyKinds.length})` : 'Saved'}
            size="lg"
            fullWidth
            loading={saving}
            disabled={dirtyKinds.length === 0}
            onPress={() => save(dirtyKinds)}
          />
          {dirtyKinds.length === 0 ? <Button title="Done" variant="ghost" onPress={() => router.back()} /> : null}
        </View>
      }>
      <Banner
        tone="info"
        icon="sparkles-outline"
        title="These power your matches"
        body="Shared interests, hobbies, skills and languages are how Sniff.in explains why you and someone else might get along."
      />
      {level ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="caption" color="textSecondary">
            Shown according to your Interests visibility:
          </Text>
          <Tag label={VIS_LABEL[level]} icon="eye-outline" small onPress={() => router.push('/settings/privacy')} />
        </View>
      ) : null}

      {SECTIONS.map((s) => (
        <Card key={s.kind} style={{ gap: 12 }}>
          <TagPicker
            kind={s.kind}
            title={s.title}
            description={s.description}
            placeholder={s.placeholder}
            starters={s.starters}
            max={MAX}
            value={sel[s.kind]}
            onChange={(next) => setSel({ ...sel, [s.kind]: next })}
          />
          {dirtyKinds.includes(s.kind) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="caption" color="warning">
                Unsaved changes
              </Text>
              <Button title={`Save ${s.title.toLowerCase()}`} size="sm" variant="secondary" loading={saving} onPress={() => save([s.kind])} />
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
