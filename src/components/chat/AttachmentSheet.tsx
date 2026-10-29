import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { palette, useTheme } from '@/theme';

export type AttachmentChoice = 'photo' | 'camera' | 'document' | 'gif' | 'sticker' | 'location';

const OPTIONS: { value: AttachmentChoice; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { value: 'photo', label: 'Photo', icon: 'images', color: palette.rani500 },
  { value: 'camera', label: 'Camera', icon: 'camera', color: palette.violet600 },
  { value: 'document', label: 'Document', icon: 'document-text', color: palette.peacock500 },
  { value: 'gif', label: 'GIF', icon: 'happy', color: palette.saffron500 },
  { value: 'sticker', label: 'Sticker', icon: 'sparkles', color: palette.marigold500 },
  { value: 'location', label: 'Location', icon: 'location', color: palette.leaf500 },
];

/** Bottom sheet of things you can add to a message. The chosen action runs after the sheet has closed. */
export function AttachmentSheet({
  visible, onClose, onChoose,
}: { visible: boolean; onClose: () => void; onChoose: (c: AttachmentChoice) => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close attachment menu" style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} />
      <View
        accessibilityViewIsModal
        style={{ backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingHorizontal: 20, paddingBottom: insets.bottom + 16, gap: 12 }}>
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
        <Text variant="heading" accessibilityRole="header">Add to chat</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 18 }}>
          {OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              onPress={() => {
                onClose();
                setTimeout(() => onChoose(o.value), 280);
              }}
              style={({ pressed }) => ({ width: '33.33%', alignItems: 'center', gap: 8, minHeight: 84, opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
              <View style={{ width: 60, height: 60, borderRadius: 22, backgroundColor: o.color, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={o.icon} size={28} color="#fff" />
              </View>
              <Text variant="caption">{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}
