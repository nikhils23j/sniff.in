import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { useForm } from 'react-hook-form';
import { TextInput, View } from 'react-native';
import { z } from 'zod';

import { AppHeader, Banner, Button, FormField, Screen, Text, toast, Waves } from '@/components/ui';
import { CaptchaChallenge } from '@/components/CaptchaChallenge';
import { authApi } from '@/features/auth/api';
import { useSessionStore } from '@/features/auth/session-store';
import { errorMessage } from '@/lib/errors';
import { env } from '@/lib/env';
import { emailSchema, otpSchema } from '@/lib/validation';
import { useTheme } from '@/theme';

const RESEND_SECONDS = 60;
const emailForm = z.object({ email: emailSchema });
const codeForm = z.object({ code: otpSchema });

function useCooldown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const start = useCallback(() => setLeft(RESEND_SECONDS), []);
  return [left, start] as const;
}

export default function ForgotPasswordScreen() {
  const t = useTheme();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [cooldown, startCooldown] = useCooldown();
  const codeRef = useRef<ComponentRef<typeof TextInput>>(null);

  const emailFm = useForm<z.input<typeof emailForm>, unknown, z.output<typeof emailForm>>({
    resolver: zodResolver(emailForm),
    defaultValues: { email: '' },
  });
  const codeFm = useForm<z.input<typeof codeForm>, unknown, z.output<typeof codeForm>>({
    resolver: zodResolver(codeForm),
    defaultValues: { code: '' },
  });

  const sendCode = emailFm.handleSubmit(async (v) => {
    if (env.turnstileSiteKey && !captchaToken) return setError('Complete the verification check first.');
    setBusy(true);
    setError(null);
    try {
      await authApi.sendPasswordReset(v.email, captchaToken ?? undefined);
      setEmail(v.email);
      setStep('code');
      startCooldown();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setCaptchaToken(null);
      setCaptchaReset((n) => n + 1);
    }
  });

  const resend = async () => {
    if (cooldown > 0 || !email) return;
    if (env.turnstileSiteKey && !captchaToken) return toast.info('Complete verification before requesting another code.');
    setBusy(true);
    try {
      await authApi.sendPasswordReset(email, captchaToken ?? undefined);
      startCooldown();
      toast.success('We sent you a new code');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      setCaptchaToken(null);
      setCaptchaReset((n) => n + 1);
    }
  };

  const verify = codeFm.handleSubmit(async ({ code }) => {
    setBusy(true);
    setError(null);
    // Mark recovery BEFORE the session appears, so the root guard shows reset-password rather than
    // flashing onboarding / the app (verifyOtp may emit SIGNED_IN instead of PASSWORD_RECOVERY).
    useSessionStore.getState().setRecovering(true);
    try {
      await authApi.verifyRecoveryCode(email, code);
    } catch (e) {
      useSessionStore.getState().setRecovering(false);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  return (
    <Screen
      header={<AppHeader title="" />}
      contentStyle={{ gap: t.spacing.xl }}>
      <View style={{ gap: 12 }}>
        <Waves size={44} />
        <Text variant="display">{step === 'email' ? 'Reset your password' : 'Enter your code'}</Text>
        <Text variant="body" color="textSecondary">
          {step === 'email' ? (
            "Enter the email you signed up with and we'll send you a 6-digit code."
          ) : (
            <>
              We sent a 6-digit code to <Text variant="bodyStrong">{email}</Text>. Enter it to choose a new password.
            </>
          )}
        </Text>
      </View>

      {error ? <Banner tone="danger" body={error} /> : null}
      <CaptchaChallenge onToken={setCaptchaToken} resetKey={captchaReset} />

      {step === 'email' ? (
        <>
          <FormField
            control={emailFm.control}
            name="email"
            label="Email"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            autoFocus
            onSubmitEditing={() => void sendCode()}
          />
          <Button title="Send code" size="lg" fullWidth loading={busy} onPress={() => void sendCode()} />
        </>
      ) : (
        <>
          <FormField
            ref={codeRef}
            control={codeFm.control}
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
            onSubmitEditing={() => void verify()}
            style={{ letterSpacing: 6, fontSize: 22 }}
          />
          <Button title="Continue" size="lg" fullWidth loading={busy} onPress={() => void verify()} />
          <View style={{ gap: 6, alignItems: 'center' }}>
            <Button
              title={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              variant="ghost"
              disabled={cooldown > 0 || busy}
              onPress={resend}
            />
            <Text variant="caption" color="textTertiary" align="center" style={{ maxWidth: 300 }}>
              Can&apos;t find it? Check your spam folder.
            </Text>
            <Button
              title="Use a different email"
              variant="ghost"
              size="sm"
              onPress={() => {
                setStep('email');
                setError(null);
                codeFm.reset();
              }}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
