import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { VisibilityChoice } from '@/components/OnboardingChoices';
import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { TextField } from '@/components/ui';
import { useOnboardingStore } from '@/features/onboarding/store';
export default function WorkStep() {
  const draft = useOnboardingStore(); const [workplace, setWorkplace] = useState(draft.workplace); const [jobTitle, setJobTitle] = useState(draft.jobTitle);
  return <OnboardingScaffold step={10} title="What do you do?" body="Optional context for better introductions. Professional skills are not collected here." onNext={() => { draft.setDraft({ workplace: workplace.trim(), jobTitle: jobTitle.trim() }); router.push('/hometown'); }} skipTo="/hometown">
    <View style={{ gap: 14 }}><TextField label="Workplace or organisation" value={workplace} onChangeText={setWorkplace} maxLength={120} /><TextField label="Job title" value={jobTitle} onChangeText={setJobTitle} maxLength={100} /></View>
    <VisibilityChoice value={draft.visibility.occupation} onChange={(occupation) => draft.setDraft({ visibility: { ...draft.visibility, occupation } })} />
  </OnboardingScaffold>;
}
