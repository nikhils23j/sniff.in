import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';

import { AppHeader, Button, Card, IconButton, Screen, Tag, Text, TextField, toast } from '@/components/ui';
import { PROFILE_PROMPTS, promptTitle } from '@/features/profile/prompts';
import { useTheme } from '@/theme';

export type PromptAnswer = { prompt_key: string; answer: string };

const GROUPS = [
  { title: 'About me', items: PROFILE_PROMPTS.slice(0, 16) },
  { title: 'Start a conversation', items: PROFILE_PROMPTS.slice(16, 27) },
  { title: 'Stories & places', items: PROFILE_PROMPTS.slice(27, 38) },
  { title: 'Everyday life', items: PROFILE_PROMPTS.slice(38) },
];

export function PromptChooser({ visible, current, used, busy, onClose, onSave, onRemove }: {
  visible: boolean;
  current: PromptAnswer | null;
  used: string[];
  busy?: boolean;
  onClose: () => void;
  onSave: (answer: PromptAnswer) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const t = useTheme();
  const [category, setCategory] = useState(0);
  const [key, setKey] = useState(current?.prompt_key ?? '');
  const [answer, setAnswer] = useState(current?.answer ?? '');
  const [page, setPage] = useState<'pick' | 'answer'>('pick');
  const close = () => { setCategory(0); setKey(''); setAnswer(''); setPage('pick'); onClose(); };
  const save = async () => {
    const value = answer.trim();
    if (!key || value.length < 3 || value.length > 240) return toast.info('Write an answer of 3–240 characters.');
    try { await onSave({ prompt_key: key, answer: value }); close(); } catch (error) { toast.error(error); }
  };
  const remove = async () => {
    if (!onRemove) return;
    try { await onRemove(); close(); } catch (error) { toast.error(error); }
  };
  const select = (next: string) => { setKey(next); setAnswer(next === current?.prompt_key ? current.answer : ''); setPage('answer'); };
  return <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="pageSheet">
    {page === 'pick' ? <Screen header={<AppHeader title="Choose a prompt" back={false} right={<IconButton icon="close" label="Close" onPress={close} />} />}>
      <Text variant="callout" color="textSecondary">Pick a question that shows your personality. You can change it later.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
        {GROUPS.map((g, i) => <Tag key={g.title} label={g.title} selected={i === category} onPress={() => setCategory(i)} />)}
      </ScrollView>
      <View style={{ gap: 10 }}>
        {GROUPS[category].items.filter((p) => !used.includes(p.key) || p.key === current?.prompt_key).map((prompt) =>
          <Card key={prompt.key} onPress={() => select(prompt.key)} style={{ borderRadius: t.radius.xl, minHeight: 68, justifyContent: 'center' }}>
            <Text variant="bodyStrong">{prompt.title}</Text>
          </Card>)}
      </View>
      {current && onRemove ? <Button title="Remove this prompt" variant="danger" loading={busy} onPress={() => void remove()} /> : null}
    </Screen> : <Screen header={<AppHeader title="Your answer" back={false} right={<IconButton icon="close" label="Close" onPress={close} />} />}
      footer={<Button title="Save answer" size="lg" fullWidth loading={busy} disabled={!key || answer.trim().length < 3 || busy} onPress={() => void save()} />}>
      <Button title="Choose another prompt" variant="ghost" size="sm" icon="arrow-back" onPress={() => setPage('pick')} />
      <Text variant="heading">{promptTitle(key)}</Text>
      <TextField label="Your answer" value={answer} onChangeText={setAnswer} multiline maxCount={240} placeholder="Write your answer…" />
    </Screen>}
  </Modal>;
}
