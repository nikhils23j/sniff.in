import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AffiliationBadge } from '@/components/AffiliationBadge';
import {
  AppHeader, Banner, Button, Card, ListGroup, Screen, SegmentedControl, Text, TextField, toast,
} from '@/components/ui';
import { useConfirmAffiliation, useOrgSearch, useStartAffiliation } from '@/features/profile/hooks';
import { toAppError } from '@/lib/errors';
import { gradients, useTheme } from '@/theme';
import type { Affiliation, AffiliationStart, OrgDomain } from '@/types/domain';

type Kind = 'college' | 'employer';
type Step = 'details' | 'code' | 'done';

const RESEND_SECONDS = 60;
const nowMs = () => Date.now();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(local.length - 1, 5)))}@${domain}`;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function VerifyAffiliationScreen() {
  const { colors, radius } = useTheme();
  const params = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<Kind>(params.kind === 'employer' ? 'employer' : 'college');
  const [step, setStep] = useState<Step>('details');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<OrgDomain | null>(null);
  const [email, setEmail] = useState('');
  const [started, setStarted] = useState<AffiliationStart | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [cooldownEnd, setCooldownEnd] = useState(0);
  const [now, setNow] = useState(nowMs);
  const [verified, setVerified] = useState<Pick<Affiliation, 'kind' | 'org_name' | 'domain'> | null>(null);

  const start = useStartAffiliation();
  const confirmCode = useConfirmAffiliation();

  const debounced = useDebounced(query.trim(), 300);
  const search = useOrgSearch(picked ? '' : debounced, kind);

  // 1-second ticker only while a resend cooldown is running.
  const secondsLeft = Math.max(0, Math.ceil((cooldownEnd - now) / 1000));
  const cooling = secondsLeft > 0;
  useEffect(() => {
    if (!cooling) return;
    const id = setInterval(() => setNow(nowMs()), 1000);
    return () => clearInterval(id);
  }, [cooling]);

  const emailTrim = email.trim();
  const emailValid = EMAIL_RE.test(emailTrim);
  const emailDomain = emailTrim.split('@')[1]?.toLowerCase() ?? '';
  const isCollege = kind === 'college';

  const orgToSend = (): string | null => {
    const n = (picked?.org_name ?? query).trim();
    return n.length >= 2 ? n : null;
  };

  const send = async (resend = false) => {
    setStartError(null);
    try {
      const res = await start.mutateAsync({ email: emailTrim, kind, orgName: started && resend ? started.org_name : orgToSend() });
      setStarted(res);
      setCode('');
      setCodeError(null);
      const t = nowMs();
      setNow(t);
      setCooldownEnd(t + RESEND_SECONDS * 1000);
      setStep('code');
      if (resend) toast.info('A new code is on its way');
    } catch (e) {
      const err = toAppError(e);
      if (resend) toast.error(err);
      else setStartError(err.message);
    }
  };

  const submitCode = async () => {
    if (!started || code.length !== 6) return;
    setCodeError(null);
    try {
      const res = await confirmCode.mutateAsync({ verificationId: started.verification_id, code });
      const aff = (res as { affiliation?: Affiliation }).affiliation;
      setVerified({ kind: aff?.kind ?? kind, org_name: aff?.org_name ?? started.org_name, domain: aff?.domain ?? emailDomain });
      setStep('done');
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'wrong_code') {
        setCodeError(err.message);
      } else if (err.code === 'code_expired' || err.code === 'too_many_attempts') {
        setCodeError(err.message);
        setCode('');
      } else if (err.code === 'not_found') {
        toast.error(err);
        setStep('details');
      } else {
        toast.error(err);
      }
    }
  };

  const reset = () => {
    setStep('details');
    setStarted(null);
    setPicked(null);
    setQuery('');
    setEmail('');
    setCode('');
    setCodeError(null);
    setStartError(null);
    setVerified(null);
    setCooldownEnd(0);
  };

  const header = <AppHeader title="Verify college or work" />;

  // ---------------------------------------------------------------- done
  if (step === 'done' && verified) {
    return (
      <Screen header={header} edges={['top', 'bottom']}>
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 16 }}>
          <LinearGradient colors={gradients.peacock} style={{ width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="shield-checkmark" size={48} color="#fff" />
          </LinearGradient>
          <Text variant="title" align="center" accessibilityRole="header">
            You&apos;re verified
          </Text>
          <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
            Your badge now shows on your profile for people who can see your badges. We only keep the domain, not your email address.
          </Text>
        </View>
        <AffiliationBadge affiliation={verified} />
        <View style={{ gap: 10 }}>
          <Button title="Done" size="lg" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <Button title="Verify another" variant="ghost" onPress={reset} />
        </View>
      </Screen>
    );
  }

  // ---------------------------------------------------------------- code
  if (step === 'code' && started) {
    const showSuggestion = !!started.suggestion && !started.registry_match;
    return (
      <Screen header={header} edges={['top', 'bottom']}>
        <Card tone="brand" style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="mail-open" size={22} color={colors.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading">Check your inbox</Text>
              <Text variant="callout" color="textSecondary">
                We sent a 6-digit code to {maskEmail(emailTrim)}. It expires in 15 minutes.
              </Text>
            </View>
          </View>
        </Card>

        <View style={{ gap: 4 }}>
          <Text variant="micro" color="textTertiary">
            {isCollege ? 'COLLEGE' : 'EMPLOYER'}
          </Text>
          <Text variant="bodyStrong">{started.org_name}</Text>
          {showSuggestion ? (
            <Text variant="caption" color="textSecondary">
              Suggested name (not yet confirmed by an official registry)
            </Text>
          ) : null}
        </View>

        <TextField
          label="6-digit code"
          value={code}
          onChangeText={(v) => {
            setCode(v.replace(/\D/g, '').slice(0, 6));
            if (codeError) setCodeError(null);
          }}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoCorrect={false}
          placeholder="••••••"
          maxCount={6}
          error={codeError ?? undefined}
          onSubmitEditing={() => { void submitCode(); }}
          style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
        />
        <Button title="Confirm" size="lg" fullWidth icon="checkmark-circle-outline" loading={confirmCode.isPending} disabled={code.length !== 6} onPress={() => { void submitCode(); }} />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Button
            title={cooling ? `Resend in ${secondsLeft}s` : 'Resend code'}
            variant="ghost"
            icon="refresh"
            loading={start.isPending}
            disabled={cooling}
            onPress={() => { void send(true); }}
          />
          <Button title="Change email" variant="ghost" onPress={() => { setStep('details'); setCode(''); setCodeError(null); }} />
        </View>
        <Text variant="caption" color="textTertiary">
          Can&apos;t find it? Check spam. The email comes from Sniff.in. Resending cancels the previous code.
        </Text>
      </Screen>
    );
  }

  // ---------------------------------------------------------------- details
  const results = picked ? [] : (search.data ?? []);
  return (
    <Screen
      header={header}
      edges={['top', 'bottom']}
      footer={
        <Button
          title="Send code"
          size="lg"
          fullWidth
          icon="paper-plane-outline"
          loading={start.isPending}
          disabled={!emailValid}
          onPress={() => { void send(); }}
        />
      }>
      <LinearGradient colors={gradients.peacock} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: 18, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="shield-checkmark" size={24} color="#fff" />
          <Text variant="heading" style={{ color: '#fff' }}>
            Earn a verified badge
          </Text>
        </View>
        <Text variant="callout" style={{ color: '#fff' }}>
          We email a code to your college/work address. The badge only appears after you enter it. Personal emails (Gmail, Outlook…) don&apos;t count.
          We store the domain, not your work email on your profile.
        </Text>
      </LinearGradient>

      <SegmentedControl<Kind>
        options={[{ value: 'college', label: 'College' }, { value: 'employer', label: 'Employer' }]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setPicked(null);
          setQuery('');
          setStartError(null);
        }}
      />

      <View style={{ gap: 10 }}>
        <TextField
          label={isCollege ? 'Your college or university' : 'Your company'}
          placeholder={isCollege ? 'Search, e.g. IIT Kanpur' : 'Search, e.g. Infosys'}
          value={query}
          onChangeText={(v) => {
            setQuery(v);
            setPicked(null);
          }}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={120}
          right={
            picked ? <Ionicons name="checkmark-circle" size={20} color={colors.success} /> : search.isFetching ? <ActivityIndicator size="small" color={colors.primary} /> : undefined
          }
        />
        {results.length > 0 ? (
          <ListGroup>
            {results.map((o) => (
              <Pressable
                key={o.domain}
                accessibilityRole="button"
                accessibilityLabel={`${o.org_name}, ${o.domain}`}
                onPress={() => {
                  setPicked(o);
                  setQuery(o.org_name);
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 52, backgroundColor: pressed ? colors.surfaceMuted : 'transparent' })}>
                <Ionicons name={o.kind === 'college' ? 'school-outline' : 'business-outline'} size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text variant="callout" numberOfLines={1}>
                    {o.org_name}
                  </Text>
                  <Text variant="caption" color="textSecondary" numberOfLines={1}>
                    @{o.domain}
                    {o.country ? ` · ${o.country}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ListGroup>
        ) : picked ? (
          <Text variant="caption" color="textSecondary">
            Listed organisation. Use your @{picked.domain} address below.
          </Text>
        ) : debounced.length >= 2 && !search.isFetching ? (
          <Text variant="caption" color="textSecondary">
            {search.isError ? "Couldn't search right now. You can still type the name." : `Not listed? We'll use "${debounced}" and check your email domain.`}
          </Text>
        ) : null}
      </View>

      <TextField
        label={isCollege ? 'College email' : 'Work email'}
        placeholder={`you@${picked?.domain ?? (isCollege ? 'college.ac.in' : 'company.com')}`}
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (startError) setStartError(null);
        }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        hint={emailTrim.length > 3 && !emailValid ? 'Enter a full email address.' : 'Gmail, Outlook and other personal emails are not accepted.'}
      />

      {startError ? <Banner tone="danger" body={startError} /> : null}

      <Text variant="caption" color="textTertiary">
        You can remove a verified badge any time from Edit profile.
      </Text>
    </Screen>
  );
}
