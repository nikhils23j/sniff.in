import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

export type MenuAction = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/**
 * Cross-platform bottom-sheet menu (Android's Alert supports only 3 buttons, so we don't use it for
 * overflow menus). The chosen action runs after the sheet has finished closing so that follow-up
 * confirmation dialogs can present reliably on iOS.
 */
export function ActionMenu({
  visible, title, actions, onClose,
}: { visible: boolean; title?: string; actions: MenuAction[]; onClose: () => void }) {
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close menu" style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} />
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingTop: 10, paddingBottom: insets.bottom + 12, paddingHorizontal: 12,
        }}>
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 8 }} />
        {title ? (
          <Text variant="caption" color="textSecondary" align="center" style={{ paddingVertical: 6 }} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {actions.map((a) => {
          const fg = a.destructive ? colors.danger : colors.text;
          return (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              disabled={a.disabled}
              onPress={() => {
                onClose();
                setTimeout(a.onPress, 280);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 14, borderRadius: radius.md,
                backgroundColor: pressed ? colors.surfaceMuted : 'transparent', opacity: a.disabled ? 0.45 : 1,
              })}>
              {a.icon ? <Ionicons name={a.icon} size={22} color={fg} /> : null}
              <Text variant="callout" style={{ color: fg, flex: 1 }}>
                {a.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onClose}
          style={({ pressed }) => ({
            marginTop: 6, minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderWidth: 1, borderColor: colors.border,
          })}>
          <Text variant="bodyStrong">Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
