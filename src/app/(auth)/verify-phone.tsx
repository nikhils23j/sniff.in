import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { CaptchaChallenge } from '@/components/CaptchaChallenge';
import { AppHeader, Banner, Button, Screen, Text, TextField } from '@/components/ui';
import { authApi } from '@/features/auth/api';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';

export default function VerifyPhoneScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(60);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  const verify = async () => {
    if (!phone || !/^\+\d{8,15}$/.test(phone)) return router.replace('/continue');
    if (!/^\d{6}$/.test(code)) return setError('Enter the six-digit code from the text message.');
    setBusy(true); setError(null);
    try { await authApi.verifyPhoneCode(phone, code); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    if (!phone || remaining > 0) return;
    if (env.turnstileSiteKey && !captchaToken) return setError('Complete the verification check first.');
    setBusy(true); setError(null);
    try { await authApi.sendPhoneCode(phone, captchaToken ?? undefined); setRemaining(60); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); setCaptchaToken(null); setCaptchaReset((n) => n + 1); }
  };

  return <Screen header={<AppHeader title="" />} contentStyle={{ gap: 20 }}>
    <View style={{ gap: 8, paddingTop: 16 }}>
      <Text variant="display">Check your texts</Text>
      <Text color="textSecondary">Enter the six-digit code sent to {phone}. This code signs you in or creates your account.</Text>
    </View>
    {error ? <Banner tone="danger" body={error} /> : null}
    <TextField label="Verification code" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, ''))} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} />
    <Button title="Continue" size="lg" fullWidth loading={busy} onPress={() => void verify()} />
    <CaptchaChallenge onToken={setCaptchaToken} resetKey={captchaReset} />
    <Button title={remaining > 0 ? `Resend code in ${remaining}s` : 'Resend code'} variant="ghost" disabled={remaining > 0 || busy} onPress={() => void resend()} />
    <Button title="Change phone number" variant="ghost" onPress={() => router.back()} />
  </Screen>;
}
