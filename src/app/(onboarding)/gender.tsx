import { router } from 'expo-router';

import { ChoiceGrid } from '@/components/OnboardingChoices';
import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { useOnboardingStore } from '@/features/onboarding/store';
import type { Gender } from '@/types/domain';

const options = [{ value: 'woman', label: 'Woman', emoji: '👩' }, { value: 'man', label: 'Man', emoji: '👨' }, { value: 'nonbinary', label: 'Non-binary', emoji: '🧑' }];
export default function GenderStep() {
  const draft = useOnboardingStore();
  return <OnboardingScaffold step={4} title="How do you identify?" body="This supports respectful introductions and your conversation preferences."
    onNext={() => router.push('/email')} nextDisabled={!draft.gender}>
    <ChoiceGrid options={options} value={draft.gender} onChange={(v) => draft.setDraft({ gender: v as Gender })} />
  </OnboardingScaffold>;
}
