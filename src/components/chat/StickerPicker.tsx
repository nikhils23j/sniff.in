import { Modal, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

import { Sticker, STICKERS } from './stickers';

export function StickerPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close stickers" style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} />
      <View
        accessibilityViewIsModal
        style={{ backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingBottom: insets.bottom + 12, maxHeight: '70%' }}>
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 10 }} />
        <Text variant="heading" accessibilityRole="header" style={{ paddingHorizontal: 20, marginBottom: 6 }}>Stickers</Text>
        <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 8 }}>
          {STICKERS.map((s, i) => (
            <Animated.View key={s.id} entering={FadeInDown.delay(i * 25).springify()} style={{ width: '33.33%', padding: 6 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Send ${s.label} sticker`}
                onPress={() => {
                  onClose();
                  setTimeout(() => onPick(s.id), 200);
                }}
                style={({ pressed }) => ({ alignItems: 'center', gap: 4, opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
                <Sticker id={s.id} size={92} />
                <Text variant="micro" color="textSecondary" numberOfLines={1}>{s.label}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
