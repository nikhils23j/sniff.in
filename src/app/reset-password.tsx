import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState, type ComponentRef } from 'react';
import { useForm } from 'react-hook-form';
import { TextInput, View } from 'react-native';
import { z } from 'zod';

import { Banner, Button, FormField, Screen, Text, toast, Waves } from '@/components/ui';
import { authApi } from '@/features/auth/api';
import { useSessionStore } from '@/features/auth/session-store';
import { errorMessage } from '@/lib/errors';
import { passwordSchema } from '@/lib/validation';
import { useTheme } from '@/theme';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export default function ResetPasswordScreen() {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<ComponentRef<typeof TextInput>>(null);

  const { control, handleSubmit } = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = handleSubmit(async (v) => {
    setBusy(true);
    setError(null);
    try {
      await authApi.updatePassword(v.password);
      useSessionStore.getState().setRecovering(false);
      toast.success('Password updated');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  const cancel = async () => {
    setCancelling(true);
    try {
      await authApi.signOut();
    } catch (e) {
      toast.error(e);
    } finally {
      useSessionStore.getState().setRecovering(false);
      setCancelling(false);
    }
  };

  return (
    <Screen contentStyle={{ gap: t.spacing.xl, paddingTop: t.spacing.xxxl }}>
      <View style={{ gap: 12 }}>
        <Waves size={44} />
        <Text variant="display">Choose a new password</Text>
        <Text variant="body" color="textSecondary">
          Pick something you haven&apos;t used before. You&apos;ll stay signed in on this device.
        </Text>
      </View>

      {error ? <Banner tone="danger" body={error} /> : null}

      <View style={{ gap: 16 }}>
        <FormField
          control={control}
          name="password"
          label="New password"
          placeholder="At least 8 characters, letters and a number"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          autoFocus
          onSubmitEditing={() => confirmRef.current?.focus()}
        />
        <FormField
          ref={confirmRef}
          control={control}
          name="confirm"
          label="Confirm new password"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => void onSubmit()}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Button title="Update password" size="lg" fullWidth loading={busy} onPress={() => void onSubmit()} />
        <Button title="Cancel" variant="ghost" fullWidth loading={cancelling} disabled={busy} onPress={cancel} />
      </View>
    </Screen>
  );
}
