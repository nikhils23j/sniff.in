import { router } from 'expo-router';
import { useState } from 'react';

import { ChoiceGrid } from '@/components/OnboardingChoices';
import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { Banner, toast } from '@/components/ui';
import { useMyTags, useSetTags } from '@/features/profile/hooks';

const OPTIONS = [
  ['music','Music','🎧'],['films','Films','🎬'],['reading','Reading','📚'],['photography','Photography','📷'],['travel','Travel','✈️'],['cooking','Cooking','🍳'],['baking','Baking','🧁'],['coffee','Coffee','☕'],
  ['fitness','Fitness','🏋️'],['running','Running','🏃'],['yoga','Yoga','🧘'],['cycling','Cycling','🚲'],['football','Football','⚽'],['cricket','Cricket','🏏'],['badminton','Badminton','🏸'],['basketball','Basketball','🏀'],
  ['trekking','Trekking','🥾'],['camping','Camping','⛺'],['nature','Nature','🌿'],['animals','Animals','🐾'],['gaming','Gaming','🎮'],['chess','Chess','♟️'],['board_games','Board games','🎲'],['puzzles','Puzzles','🧩'],
  ['art','Art','🎨'],['dance','Dance','💃'],['singing','Singing','🎤'],['guitar','Guitar','🎸'],['writing','Writing','✍️'],['poetry','Poetry','📝'],['fashion','Fashion','👗'],['design','Design','✨'],
  ['food','Food spots','🍜'],['nightlife','Nightlife','🌙'],['volunteering','Volunteering','🤝'],['meditation','Meditation','🪷'],['podcasts','Podcasts','🎙️'],['comedy','Comedy','😂'],['languages','Languages','🗣️'],['gardening','Gardening','🪴'],
].map(([value,label,emoji]) => ({ value, label, emoji }));

export default function InterestsStep() {
  const mine = useMyTags(); const save = useSetTags(); const [selection, setSelection] = useState<string[] | null>(null);
  const selected = selection ?? mine.data?.filter((x) => x.kind === 'interest').map((x) => x.name) ?? [];
  const update = (next: string | string[]) => { const values = next as string[]; if (values.length > 15) return toast.info('Choose up to 15 interests.'); setSelection(values); };
  const next = async () => { try { await save.mutateAsync({ kind: 'interest', names: selected }); router.push('/education'); } catch (e) { toast.error(e); } };
  return <OnboardingScaffold step={7} title="What are you into?" body="Pick at least three hobbies or interests. These help explain why someone may be good to talk to."
    onNext={next} nextDisabled={selected.length < 3} loading={save.isPending} skipTo="/education">
    <Banner tone="accent" icon="sparkles" body={`${selected.length}/15 selected · choose at least 3`} />
    <ChoiceGrid multi options={OPTIONS} value={selected} onChange={update} />
  </OnboardingScaffold>;
}
