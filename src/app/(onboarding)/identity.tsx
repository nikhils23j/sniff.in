import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { Banner, TextField, toast } from '@/components/ui';
import { useSession } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/store';
import { profileApi } from '@/features/profile/api';
import { displayNameSchema, dobSchema, usernameSchema } from '@/lib/validation';
import { useTheme } from '@/theme';

const formatDob = (raw: string) => { const d = raw.replace(/\D/g, '').slice(0, 8); return d.length <= 4 ? d : d.length <= 6 ? `${d.slice(0, 4)}-${d.slice(4)}` : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`; };

export default function IdentityStep() {
  const t = useTheme();
  const draft = useOnboardingStore();
  const session = useSession();
  const [name, setName] = useState(draft.displayName || String(session?.user.user_metadata?.display_name ?? ''));
  const [username, setUsername] = useState(draft.username);
  const [dob, setDob] = useState(draft.dateOfBirth);
  const [check, setCheck] = useState<{ username: string; available: boolean } | null>(null);
  useEffect(() => {
    if (!usernameSchema.safeParse(username).success) return;
    let live = true;
    const timer = setTimeout(() => void profileApi.isUsernameAvailable(username).then((available) => { if (live) setCheck({ username, available }); }).catch(() => {}), 400);
    return () => { live = false; clearTimeout(timer); };
  }, [username]);
  const available = check?.username === username ? check.available : null;
  const checking = usernameSchema.safeParse(username).success && check?.username !== username;
  const valid = displayNameSchema.safeParse(name).success && usernameSchema.safeParse(username).success && dobSchema.safeParse(dob).success && available === true;
  const next = () => { if (!valid) return toast.info('Complete each field and choose an available username.'); draft.setDraft({ displayName: name.trim(), username: username.toLowerCase(), dateOfBirth: dob }); router.push('/gender'); };
  return <OnboardingScaffold step={3} title="What should we call you?" body="Use the name people know you by and choose your unique Sniff.in handle." onNext={next} nextDisabled={!valid}>
    <View style={{ gap: 14 }}>
      <TextField label="Name" value={name} onChangeText={setName} autoComplete="name" autoCapitalize="words" />
      <TextField label="Username" value={username} onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))} autoCapitalize="none" maxLength={20}
        right={checking ? <ActivityIndicator color={t.colors.primary} /> : available === true ? <Ionicons name="checkmark-circle" size={22} color={t.colors.success} /> : undefined}
        hint={available === false ? 'That username is already taken.' : '3–20 letters, numbers, or underscores.'} />
      <TextField label="Birthday" value={dob} onChangeText={(v) => setDob(formatDob(v))} keyboardType="number-pad" placeholder="YYYY-MM-DD" maxLength={10} />
      <Banner tone="info" icon="lock-closed" body="Your birthday stays private and confirms that you are 18 or older." />
    </View>
  </OnboardingScaffold>;
}
