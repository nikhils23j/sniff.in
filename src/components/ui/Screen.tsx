import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { Text } from './Text';

type ScreenProps = {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Pull-to-refresh handler (scroll screens only). */
  onRefresh?: () => void;
  refreshing?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  edges?: ('top' | 'bottom')[];
  contentStyle?: StyleProp<ViewStyle>;
  keyboard?: boolean;
};

/** Safe-area aware page container with optional scroll, header and sticky footer. */
export function Screen({
  children, scroll = true, padded = true, onRefresh, refreshing = false, header, footer, edges = ['top'], contentStyle, keyboard = true,
}: ScreenProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pad = padded ? t.spacing.xl : 0;
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} /> : undefined}
      contentContainerStyle={[{ padding: pad, paddingBottom: pad + (edges.includes('bottom') ? insets.bottom : 0) + 24, gap: t.spacing.lg }, contentStyle]}>
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, paddingHorizontal: pad }, contentStyle]}>{children}</View>
  );
  const inner = (
    <View style={{ flex: 1, backgroundColor: t.colors.background, paddingTop: edges.includes('top') ? insets.top : 0 }}>
      {header}
      {body}
      {footer ? (
        <View style={{ paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.md, paddingBottom: Math.max(insets.bottom, 16), borderTopWidth: 1, borderTopColor: t.colors.border, backgroundColor: t.colors.background }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
  if (!keyboard) return inner;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {inner}
    </KeyboardAvoidingView>
  );
}

/** Compact in-screen header with optional back button and right-side actions. */
export function AppHeader({
  title, subtitle, back = true, right, large,
}: { title: string; subtitle?: string; back?: boolean; right?: React.ReactNode; large?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: back ? 8 : t.spacing.xl, paddingVertical: 8, minHeight: 52, gap: 4 }}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.colors.surfaceMuted : 'transparent' })}>
          <Ionicons name="chevron-back" size={24} color={t.colors.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text variant={large ? 'title' : 'heading'} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{right}</View> : null}
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
      <Text variant="micro" color="textTertiary" accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {action}
    </View>
  );
}
