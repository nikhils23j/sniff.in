import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { StepProgress } from '@/components/StepProgress';
import { Button, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme';

type Props = {
  step: number;
  title: string;
  body?: string;
  children: ReactNode;
  onNext: () => void | Promise<void>;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
  skipTo?: string;
  back?: boolean;
};

/** Shared, accessible shell for the 15 short onboarding decisions. */
export function OnboardingScaffold({
  step, title, body, children, onNext, nextLabel = 'Continue', nextDisabled, loading, skipTo, back = true,
}: Props) {
  const t = useTheme();
  return (
    <Screen
      header={<StepProgress step={step} total={15} back={back} />}
      contentStyle={{ gap: t.spacing.xl }}
      footer={
        <View style={{ gap: 4 }}>
          <Button title={nextLabel} size="lg" fullWidth iconRight="arrow-forward" disabled={nextDisabled} loading={loading} onPress={() => void onNext()} />
          {skipTo ? <Button title="Skip for now" variant="ghost" onPress={() => router.push(skipTo as never)} /> : null}
        </View>
      }>
      <View style={{ gap: 8 }}>
        <Text variant="display" accessibilityRole="header">{title}</Text>
        {body ? <Text variant="body" color="textSecondary">{body}</Text> : null}
      </View>
      {children}
    </Screen>
  );
}
