import { router } from 'expo-router';
import { useState } from 'react';
import { VisibilityChoice } from '@/components/OnboardingChoices';
import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { TextField } from '@/components/ui';
import { useOnboardingStore } from '@/features/onboarding/store';
export default function HometownStep() {
  const draft = useOnboardingStore(); const [value, setValue] = useState(draft.hometown);
  return <OnboardingScaffold step={9} title="Where’s home?" body="Your hometown can be an easy conversation starter." onNext={() => { draft.setDraft({ hometown: value.trim() }); router.push('/photos'); }} skipTo="/photos">
    <TextField label="Hometown" value={value} onChangeText={setValue} autoCapitalize="words" maxLength={100} placeholder="City, state or country" />
    <VisibilityChoice value={draft.visibility.hometown} onChange={(hometown) => draft.setDraft({ visibility: { ...draft.visibility, hometown } })} />
  </OnboardingScaffold>;
}
