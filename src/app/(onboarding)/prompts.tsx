import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { PromptChooser, type PromptAnswer } from '@/components/PromptChooser';
import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { Button, Card, Text, toast } from '@/components/ui';
import { useOnboardingStore } from '@/features/onboarding/store';
import { profileApi } from '@/features/profile/api';
import { PROFILE_PROMPTS } from '@/features/profile/prompts';
import { qk } from '@/lib/query-client';

export default function PromptsStep() {
  const draft = useOnboardingStore();
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<(PromptAnswer | null)[]>([null, null, null]);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const complete = async () => {
    setFinishing(true);
    try {
      await profileApi.completeOnboardingProfile(draft);
      for (const item of answers) if (item) await profileApi.setPrompt(item.prompt_key, item.answer);
      await qc.invalidateQueries({ queryKey: qk.me });
      draft.reset();
      router.replace('/discover');
    } catch (error) { toast.error(error); } finally { setFinishing(false); }
  };
  const save = async (value: PromptAnswer) => {
    setAnswers((current) => {
      const next = [...current];
      if (activeSlot !== null) next[activeSlot] = value;
      return next;
    });
  };
  const remove = async () => { if (activeSlot !== null) setAnswers((current) => current.map((item, i) => i === activeSlot ? null : item)); };
  return <OnboardingScaffold step={11} title="Start a conversation" body="Choose prompts that help people get to know you. You can add up to three and edit them later."
    onNext={() => void complete()} nextLabel="Finish setup" loading={finishing}>
    {Array.from({ length: 3 }, (_, i) => {
      const existing = answers[i];
      return <Card key={i} onPress={() => setActiveSlot(i)} style={{ minHeight: 90, gap: 6, justifyContent: 'center' }}>
        <Text variant="caption" color="primary">PROMPT {i + 1}</Text>
        <Text variant="bodyStrong">{existing ? PROFILE_PROMPTS.find((p) => p.key === existing.prompt_key)?.title : '+ Add a prompt'}</Text>
        {existing ? <Text variant="callout" color="textSecondary">{existing.answer}</Text> : null}
      </Card>;
    })}
    <Button title="Finish without prompts" variant="ghost" disabled={finishing} onPress={() => void complete()} />
    {activeSlot !== null ? <PromptChooser key={`onboarding-${activeSlot}-${answers[activeSlot]?.prompt_key ?? 'empty'}`}
      visible current={answers[activeSlot] ?? null} used={answers.flatMap((a) => a ? [a.prompt_key] : [])}
      onClose={() => setActiveSlot(null)} onSave={save} onRemove={remove} /> : null}
  </OnboardingScaffold>;
}
