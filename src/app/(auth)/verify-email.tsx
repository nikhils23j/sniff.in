import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';

import { AppHeader, Banner, Button, FormField, Screen, Text, toast, Waves } from '@/components/ui';
import { CaptchaChallenge } from '@/components/CaptchaChallenge';
import { authApi } from '@/features/auth/api';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { otpSchema } from '@/lib/validation';
import { useTheme } from '@/theme';

const RESEND_SECONDS = 60;
const schema = z.object({ code: otpSchema });
type FormValues = z.input<typeof schema>;

/** Counts down once per second; `start()` restarts it. */
function useCooldown(initial: number) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const start = useCallback(() => setLeft(RESEND_SECONDS), []);
  return [left, start] as const;
}

export default function VerifyEmailScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = (Array.isArray(params.email) ? params.email[0] : params.email) ?? '';
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  // A code was just sent when we arrived here, so start the cooldown immediately.
  const [cooldown, restartCooldown] = useCooldown(RESEND_SECONDS);

  const { control, handleSubmit } = useForm<FormValues, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
  });

  const onSubmit = handleSubmit(async ({ code }) => {
    if (!email) return setFormError('We lost track of your email. Go back and sign in or sign up again.');
    setSubmitting(true);
    setFormError(null);
    try {
      await authApi.verifySignupCode(email, code);
      // A session now exists; the root navigator moves on to onboarding by itself.
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  });

  const resend = async () => {
    if (!email || cooldown > 0) return;
    if (env.turnstileSiteKey && !captchaToken) return toast.info('Complete verification before requesting another code.');
    setResending(true);
    setFormError(null);
    try {
      await authApi.resendSignupCode(email, captchaToken ?? undefined);
      restartCooldown();
      toast.success('We sent you a new code');
    } catch (e) {
      toast.error(e);
    } finally {
      setResending(false);
      setCaptchaToken(null);
      setCaptchaReset((n) => n + 1);
    }
  };

  return (
    <Screen header={<AppHeader title="" />} contentStyle={{ gap: t.spacing.xl }}>
      <View style={{ gap: 12 }}>
        <Waves size={44} />
        <Text variant="display">Check your email</Text>
        <Text variant="body" color="textSecondary">
          {email ? (
            <>
              We sent a 6-digit code to <Text variant="bodyStrong">{email}</Text>. Enter it below to confirm your account.
            </>
          ) : (
            'Enter the 6-digit code we emailed you.'
          )}
        </Text>
      </View>

      {formError ? <Banner tone="danger" body={formError} /> : null}

      <FormField
        control={control}
        name="code"
        label="Verification code"
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={8}
        returnKeyType="done"
        autoFocus
        onSubmitEditing={() => void onSubmit()}
        style={{ letterSpacing: 6, fontSize: 22 }}
      />

      <Button title="Verify" size="lg" fullWidth loading={submitting} onPress={() => void onSubmit()} />

      <CaptchaChallenge onToken={setCaptchaToken} resetKey={captchaReset} />

      <View style={{ gap: 6, alignItems: 'center' }}>
        <Button
          title={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          variant="ghost"
          disabled={cooldown > 0 || !email}
          loading={resending}
          onPress={resend}
        />
        <Text variant="caption" color="textTertiary" align="center" style={{ maxWidth: 300 }}>
          Can&apos;t find it? Check your spam or promotions folder. Codes expire after a while, so use the newest one.
        </Text>
        <Button title="Use a different email" variant="ghost" size="sm" onPress={() => router.replace('/sign-up')} />
      </View>
    </Screen>
  );
}
