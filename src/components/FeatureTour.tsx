import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { useTheme } from '@/theme';

type TourCard = { icon: keyof typeof Ionicons.glyphMap; title: string; body: string };

export function FeatureTour({ cards, eligible, onComplete }: { cards: TourCard[]; eligible: boolean; onComplete: () => void }) {
  const t = useTheme(); const [visible, setVisible] = useState(false); const [step, setStep] = useState(0);
  useEffect(() => { if (eligible) setVisible(true); }, [eligible]);
  const close = () => { setVisible(false); onComplete(); };
  const card = cards[step]; if (!card) return null;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <View style={{ flex: 1, backgroundColor: t.colors.overlay, justifyContent: 'center', padding: 24 }}>
      <View style={{ backgroundColor: t.colors.surface, borderRadius: t.radius.xl, padding: 24, gap: 18 }}>
        <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={card.icon} size={28} color={t.colors.primary} /></View>
        <View style={{ gap: 8 }}><Text variant="title">{card.title}</Text><Text variant="body" color="textSecondary">{card.body}</Text></View>
        <View style={{ flexDirection: 'row', gap: 6 }}>{cards.map((_, i) => <View key={i} style={{ height: 5, flex: 1, borderRadius: 3, backgroundColor: i <= step ? t.colors.primary : t.colors.border }} />)}</View>
        <Button title={step === cards.length - 1 ? 'Got it' : 'Next'} iconRight={step === cards.length - 1 ? 'checkmark' : 'arrow-forward'} onPress={() => step === cards.length - 1 ? close() : setStep((v) => v + 1)} />
        <Button title="Skip" variant="ghost" size="sm" onPress={close} />
      </View>
    </View>
  </Modal>;
}
