import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Simple full-screen image viewer (no gestures): tap anywhere or the close button to dismiss. */
export function ImageViewer({ uri, visible, onClose, label = 'Photo' }: { uri: string | null | undefined; visible: boolean; onClose: () => void; label?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible && !!uri} animationType="fade" transparent statusBarTranslucent onRequestClose={onClose}>
      <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={onClose} style={{ flex: 1, justifyContent: 'center' }}>
          {uri ? <Image source={{ uri }} accessibilityLabel={label} contentFit="contain" style={{ width: '100%', height: '100%' }} /> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          onPress={onClose}
          style={{
            position: 'absolute', top: insets.top + 10, right: 16, width: 44, height: 44, borderRadius: 22,
            backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
          }}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}
