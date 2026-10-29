import Ionicons from '@expo/vector-icons/Ionicons';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { Alert, Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { errorMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

import { Text } from './Text';

// ---------------------------------------------------------------- toasts
type Toast = { id: number; message: string; tone: 'success' | 'error' | 'info' };
const useToastStore = create<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 3200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (message: string) => useToastStore.getState().push({ message, tone: 'success' }),
  info: (message: string) => useToastStore.getState().push({ message, tone: 'info' }),
  error: (e: unknown) => useToastStore.getState().push({ message: typeof e === 'string' ? e : errorMessage(e), tone: 'error' }),
};

function ToastItem({ t }: { t: Toast }) {
  const { colors, radius } = useTheme();
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
  }, [anim]);
  const icon = t.tone === 'success' ? 'checkmark-circle' : t.tone === 'error' ? 'alert-circle' : 'information-circle';
  const tint = t.tone === 'success' ? colors.success : t.tone === 'error' ? colors.danger : colors.primary;
  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
        flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.lg,
        paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border,
        shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6,
      }}>
      <Ionicons name={icon} size={20} color={tint} />
      <Text variant="callout" style={{ flex: 1 }}>
        {t.message}
      </Text>
      <Pressable accessibilityLabel="Dismiss" hitSlop={10} onPress={() => useToastStore.getState().dismiss(t.id)}>
        <Ionicons name="close" size={18} color={colors.textTertiary} />
      </Pressable>
    </Animated.View>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const insets = useSafeAreaInsets();
  if (!toasts.length) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, gap: 8, zIndex: 1000 }}>
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- banners
export function Banner({
  tone = 'info', title, body, icon, action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success' | 'accent';
  title?: string;
  body: string;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: { label: string; onPress: () => void };
}) {
  const { colors, radius } = useTheme();
  const map = {
    info: [colors.primarySoft, colors.primary, 'information-circle'],
    warning: [colors.warningSoft, colors.warning, 'time'],
    danger: [colors.dangerSoft, colors.danger, 'warning'],
    success: [colors.successSoft, colors.success, 'checkmark-circle'],
    accent: [colors.accentSoft, colors.accentStrong, 'radio'],
  } as const;
  const [bg, fg, defIcon] = map[tone];
  return (
    <View style={{ flexDirection: 'row', gap: 10, backgroundColor: bg, borderRadius: radius.lg, padding: 14, alignItems: 'flex-start' }}>
      <Ionicons name={icon ?? defIcon} size={20} color={fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text variant="subheading">{title}</Text> : null}
        <Text variant="callout" color="textSecondary">
          {body}
        </Text>
        {action ? (
          <Pressable accessibilityRole="button" onPress={action.onPress} style={{ marginTop: 6 }}>
            <Text variant="bodyStrong" style={{ color: fg }}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const { colors } = useTheme();
  useEffect(() => NetInfo.addEventListener((s) => setOffline(s.isConnected === false)), []);
  if (!offline) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: colors.text, paddingVertical: 6, alignItems: 'center' }}>
      <Text variant="caption" style={{ color: colors.background }}>
        You&apos;re offline. Changes will sync when you reconnect.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- confirm dialog
/** Native confirmation dialog as a promise. Destructive actions get the red button. */
export function confirm(opts: { title: string; message?: string; confirmLabel?: string; destructive?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(opts.title, opts.message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: opts.confirmLabel ?? 'Confirm', style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
