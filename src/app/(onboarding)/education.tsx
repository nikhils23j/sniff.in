import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ChoiceGrid, VisibilityChoice } from '@/components/OnboardingChoices';
import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { TextField } from '@/components/ui';
import { useOnboardingStore } from '@/features/onboarding/store';
const levels = ['School','Diploma','Undergraduate','Postgraduate','Doctorate','Prefer not to say'].map((label) => ({ value: label.toLowerCase().replaceAll(' ','_'), label }));
export default function EducationStep() {
  const draft = useOnboardingStore(); const [level, setLevel] = useState(draft.educationLevel); const [school, setSchool] = useState(draft.schoolName);
  return <OnboardingScaffold step={9} title="Your education" body="Share as much or as little as you like." onNext={() => { draft.setDraft({ educationLevel: level, schoolName: school.trim() }); router.push('/work'); }} skipTo="/work">
    <View style={{ gap: 16 }}><ChoiceGrid options={levels} value={level} onChange={(v) => setLevel(v as string)} /><TextField label="School or college" value={school} onChangeText={setSchool} placeholder="Where did you study?" maxLength={120} /></View>
    <VisibilityChoice value={draft.visibility.education} onChange={(education) => draft.setDraft({ visibility: { ...draft.visibility, education } })} />
  </OnboardingScaffold>;
}
