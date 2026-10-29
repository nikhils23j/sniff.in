import Ionicons from '@expo/vector-icons/Ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, TextInput, View } from 'react-native';
import { z } from 'zod';

import { AppHeader, Banner, Button, FormField, Screen, Text, Waves } from '@/components/ui';
import { CaptchaChallenge } from '@/components/CaptchaChallenge';
import { authApi } from '@/features/auth/api';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { displayNameSchema, emailSchema, passwordSchema } from '@/lib/validation';
import { useTheme } from '@/theme';

const schema = z
  .object({
    name: displayNameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirm: z.string(),
    agreed: z.boolean().refine((v) => v, 'Please confirm to continue'),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type FormValues = z.input<typeof schema>;

export default function SignUpScreen() {
  const t = useTheme();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const confirmRef = useRef<ComponentRef<typeof TextInput>>(null);

  const { control, handleSubmit } = useForm<FormValues, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', confirm: '', agreed: false },
  });

  const onSubmit = handleSubmit(async (v) => {
    if (env.turnstileSiteKey && !captchaToken) return setFormError('Complete the verification check first.');
    setSubmitting(true);
    setFormError(null);
    try {
      const { needsVerification } = await authApi.signUp(v.email, v.password, v.name, captchaToken ?? undefined);
      // Without email confirmation a session exists already and the root navigator takes over.
      if (needsVerification) router.push({ pathname: '/verify-email', params: { email: v.email } });
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSubmitting(false);
      setCaptchaToken(null);
      setCaptchaReset((n) => n + 1);
    }
  });

  return (
    <Screen header={<AppHeader title="" />} contentStyle={{ gap: t.spacing.xl }}>
      <View style={{ gap: 12 }}>
        <Waves size={44} />
        <Text variant="display">Create your account</Text>
        <Text variant="body" color="textSecondary">
          It takes a minute. We will email you a 6-digit code to confirm it is you.
        </Text>
      </View>

      {formError ? <Banner tone="danger" body={formError} /> : null}

      <View style={{ gap: 16 }}>
        <FormField
          control={control}
          name="name"
          label="Your name"
          placeholder="How should people address you?"
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
        />
        <FormField
          ref={emailRef}
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
          placeholder="At least 8 characters, letters and a number"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
        />
        <FormField
          ref={confirmRef}
          control={control}
          name="confirm"
          label="Confirm password"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => void onSubmit()}
        />
      </View>

      <Controller
        control={control}
        name="agreed"
        render={({ field, fieldState }) => (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="I confirm I am 18 or older"
                accessibilityState={{ checked: field.value }}
                hitSlop={8}
                onPress={() => field.onChange(!field.value)}
                style={{
                  width: 26, height: 26, borderRadius: 8, marginTop: 1, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1.5, borderColor: fieldState.error ? t.colors.danger : field.value ? t.colors.primary : t.colors.borderStrong,
                  backgroundColor: field.value ? t.colors.primary : t.colors.surface,
                }}>
                {field.value ? <Ionicons name="checkmark" size={18} color={t.colors.onPrimary} /> : null}
              </Pressable>
              <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>I confirm I am 18 or older.</Text>
            </View>
            {fieldState.error ? (
              <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
                {fieldState.error.message}
              </Text>
            ) : null}
          </View>
        )}
      />

      <CaptchaChallenge onToken={setCaptchaToken} resetKey={captchaReset} />
      <View style={{ gap: 8 }}>
        <Button title="Create account" size="lg" fullWidth loading={submitting} onPress={() => void onSubmit()} />
        <Button title="I already have an account" variant="ghost" fullWidth onPress={() => router.replace('/sign-in')} />
      </View>
    </Screen>
  );
}
