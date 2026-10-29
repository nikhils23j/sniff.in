import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Animated, View, type DimensionValue } from 'react-native';

import { errorMessage, toAppError } from '@/lib/errors';
import { useTheme } from '@/theme';

import { Button } from './Button';
import { Text } from './Text';
import { Waves } from './Waves';

export function EmptyState({
  title, body, icon, action, compact,
}: {
  title: string;
  body?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: { label: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap };
  compact?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? 24 : 48, paddingHorizontal: 24, gap: 12 }}>
      {icon ? (
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={28} color={colors.primary} />
        </View>
      ) : (
        <Waves size={72} />
      )}
      <Text variant="heading" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {action ? <Button title={action.label} icon={action.icon} onPress={action.onPress} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const { colors } = useTheme();
  const offline = toAppError(error).code === 'network';
  return (
    <View accessibilityRole="alert" style={{ alignItems: 'center', paddingVertical: compact ? 20 : 40, paddingHorizontal: 24, gap: 10 }}>
      <Ionicons name={offline ? 'cloud-offline-outline' : 'alert-circle-outline'} size={32} color={offline ? colors.textSecondary : colors.danger} />
      <Text variant="subheading" align="center">
        {offline ? "You're offline" : "Couldn't load this"}
      </Text>
      <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 300 }}>
        {errorMessage(error)}
      </Text>
      {onRetry ? <Button title="Try again" variant="secondary" size="sm" icon="refresh" onPress={onRetry} style={{ marginTop: 6 }} /> : null}
    </View>
  );
}

export function Skeleton({ width = '100%', height = 14, radius = 8 }: { width?: DimensionValue; height?: number; radius?: number }) {
  const { colors } = useTheme();
  const [opacity] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={{ width, height, borderRadius: radius, backgroundColor: colors.surfaceMuted, opacity }} />;
}

/** Placeholder matching a person/server card while loading. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  const { colors, radius } = useTheme();
  return (
    <View
      accessibilityLabel="Loading"
      style={{ flexDirection: 'row', gap: 14, padding: 16, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Skeleton width={52} height={52} radius={26} />
      <View style={{ flex: 1, gap: 10, paddingTop: 4 }}>
        <Skeleton width="55%" height={16} />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} width={i === lines - 1 ? '80%' : '100%'} height={12} />
        ))}
      </View>
    </View>
  );
}

export function LoadingList({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}
