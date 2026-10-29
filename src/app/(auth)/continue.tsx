import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { CaptchaChallenge } from '@/components/CaptchaChallenge';
import { AppHeader, Banner, Button, Screen, Text, TextField } from '@/components/ui';
import { authApi } from '@/features/auth/api';
import { e164Phone } from '@/features/auth/phone';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

type Methods = Awaited<ReturnType<typeof authApi.availableMethods>>;
const COUNTRY_CODES = [
  ['India', '+91'], ['United States / Canada', '+1'], ['United Kingdom', '+44'],
  ['Australia', '+61'], ['Germany', '+49'], ['France', '+33'], ['United Arab Emirates', '+971'],
  ['Singapore', '+65'], ['Japan', '+81'], ['South Korea', '+82'], ['Pakistan', '+92'],
  ['Bangladesh', '+880'], ['Nepal', '+977'],
] as const;

export default function ContinueScreen() {
  const t = useTheme();
  const [country, setCountry] = useState('+91');
  const [countryMenu, setCountryMenu] = useState(false);
  const [local, setLocal] = useState('');
  const [methods, setMethods] = useState<Methods | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'phone' | 'google' | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  useEffect(() => {
    let mounted = true;
    authApi.availableMethods().then((next) => { if (mounted) setMethods(next); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const getCode = async () => {
    const phone = e164Phone(country, local);
    if (!phone) return setError('Enter a valid phone number with its country code.');
    if (methods?.phone === false) return setError('Phone sign-in is not active yet. Use email while SMS delivery is being configured.');
    if (env.turnstileSiteKey && !captchaToken) return setError('Complete the verification check first.');
    setBusy('phone'); setError(null);
    try {
      await authApi.sendPhoneCode(phone, captchaToken ?? undefined);
      router.push({ pathname: '/verify-phone', params: { phone } });
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); setCaptchaToken(null); setCaptchaReset((n) => n + 1); }
  };

  const social = async () => {
    if (methods?.google === false) {
      setError('Google sign-in is not active yet. Continue with email for now.');
      return;
    }
    setBusy('google'); setError(null);
    try { await authApi.signInWithGoogle(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  };

  return <Screen header={<AppHeader title="" />} contentStyle={{ gap: 20 }}>
    <View style={{ gap: 8, paddingTop: 16 }}>
      <Text variant="display">Join your people</Text>
      <Text color="textSecondary">Create an account or sign in. Pick whichever method works for you.</Text>
    </View>
    {error ? <Banner tone="warning" body={error} /> : null}
    <View style={{ gap: 12 }}>
      <Text variant="bodyStrong">Continue with phone</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ width: 86 }}>
          <TextField label="Code" value={country} onChangeText={setCountry} keyboardType="phone-pad" maxLength={4} accessibilityHint="Country calling code, for example plus 91 for India" right={
            <Pressable accessibilityRole="button" accessibilityLabel="Choose country code" hitSlop={8} onPress={() => setCountryMenu(true)}>
              <Ionicons name="chevron-down" size={17} color={t.colors.textSecondary} />
            </Pressable>
          } />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="Phone number" value={local} onChangeText={setLocal} placeholder="Enter phone number" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={15} />
        </View>
      </View>
      <Text variant="caption" color="textSecondary">We’ll text you a one-time code. Standard SMS rates may apply.</Text>
      <CaptchaChallenge onToken={setCaptchaToken} resetKey={captchaReset} />
      <Button title="Get code" size="lg" fullWidth loading={busy === 'phone'} disabled={busy !== null} onPress={() => void getCode()} />
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ height: 1, flex: 1, backgroundColor: t.colors.border }} />
      <Text color="textTertiary">or</Text>
      <View style={{ height: 1, flex: 1, backgroundColor: t.colors.border }} />
    </View>
    <View style={{ gap: 10 }}>
      <Button title="Continue with email" variant="secondary" icon="mail-outline" size="lg" fullWidth onPress={() => router.push('/sign-in')} />
      <Button title="Continue with Google" variant="secondary" icon="logo-google" size="lg" fullWidth loading={busy === 'google'} disabled={busy !== null} onPress={() => void social()} />
    </View>
    <Modal visible={countryMenu} transparent animationType="slide" onRequestClose={() => setCountryMenu(false)}>
      <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }} onPress={() => setCountryMenu(false)}>
        <View style={{ maxHeight: '65%', backgroundColor: t.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 }}>
          <Text variant="heading" style={{ marginBottom: 12 }}>Country code</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {COUNTRY_CODES.map(([name, code]) => <Pressable key={name} accessibilityRole="button" accessibilityLabel={`${name}, ${code}`} onPress={() => { setCountry(code); setCountryMenu(false); }} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderColor: t.colors.border }}>
              <Text>{name}</Text><Text color="textSecondary">{code}</Text>
            </Pressable>)}
          </ScrollView>
          <Text variant="caption" color="textSecondary" style={{ marginTop: 12 }}>For other countries, type the calling code in the Code field.</Text>
        </View>
      </Pressable>
    </Modal>
  </Screen>;
}
