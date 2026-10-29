import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, TextInput, View } from 'react-native';
import { z } from 'zod';

import { AppHeader, Banner, Button, FormField, Screen, Text, toast, Waves } from '@/components/ui';
import { CaptchaChallenge } from '@/components/CaptchaChallenge';
import { authApi } from '@/features/auth/api';
import { env } from '@/lib/env';
import { toAppError } from '@/lib/errors';
import { emailSchema } from '@/lib/validation';
import { useTheme } from '@/theme';

const schema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') });
type FormValues = z.input<typeof schema>;

export default function SignInScreen() {
  const t = useTheme();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ code: string; message: string; email: string } | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const { control, handleSubmit } = useForm<FormValues, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (v) => {
    if (env.turnstileSiteKey && !captchaToken) return setError({ code: 'captcha_required', message: 'Complete the verification check first.', email: v.email });
    setSubmitting(true);
    setError(null);
    try {
      await authApi.signIn(v.email, v.password, captchaToken ?? undefined);
      // The session listener routes to onboarding or the app.
    } catch (e) {
      const err = toAppError(e);
      setError({ code: err.code, message: err.message, email: v.email });
    } finally {
      setSubmitting(false);
      setCaptchaToken(null);
      setCaptchaReset((n) => n + 1);
    }
  });

  const verifyNow = async () => {
    if (!error) return;
    if (env.turnstileSiteKey && !captchaToken) return toast.info('Complete verification before requesting a code.');
    setSendingCode(true);
    try {
      await authApi.resendSignupCode(error.email, captchaToken ?? undefined);
    } catch (e) {
      // Still let them enter a code they may already have; they can resend from the next screen.
      toast.error(e);
    } finally {
      setSendingCode(false);
      setCaptchaToken(null);
      setCaptchaReset((n) => n + 1);
    }
    router.push({ pathname: '/verify-email', params: { email: error.email } });
  };

  return (
    <Screen header={<AppHeader title="" />} contentStyle={{ gap: t.spacing.xl }}>
      <View style={{ gap: 12 }}>
        <Waves size={44} />
        <Text variant="display">Welcome back</Text>
        <Text variant="body" color="textSecondary">
          Sign in to pick up where you left off.
        </Text>
      </View>

      {error?.code === 'email_not_confirmed' ? (
        <Banner
          tone="warning"
          title="Verify your email first"
          body="Your email isn't confirmed yet. We can send you a fresh 6-digit code."
          action={{ label: sendingCode ? 'Sending…' : 'Send code and verify', onPress: sendingCode ? () => {} : verifyNow }}
        />
      ) : error ? (
        <Banner tone="danger" body={error.message} />
      ) : null}

      <View style={{ gap: 16 }}>
        <FormField
          control={control}
          name="email"
          label="Email"
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <FormField
          ref={passwordRef}
          control={control}
          name="password"
          label="Password"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
        />
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Forgot password"
          hitSlop={8}
          onPress={() => router.push('/forgot-password')}
          style={{ alignSelf: 'flex-end' }}>
          <Text variant="callout" style={{ color: t.colors.primary }}>
            Forgot password?
          </Text>
        </Pressable>
      </View>

      <CaptchaChallenge onToken={setCaptchaToken} resetKey={captchaReset} />
      <View style={{ gap: 8 }}>
        <Button title="Sign in" size="lg" fullWidth loading={submitting} onPress={() => void onSubmit()} />
        <Button title="Create an account" variant="ghost" fullWidth onPress={() => router.replace('/sign-up')} />
      </View>
    </Screen>
  );
}
