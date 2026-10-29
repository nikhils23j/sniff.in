import { router } from 'expo-router';
import { useState } from 'react';

import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { Banner, TextField, toast } from '@/components/ui';
import { authApi } from '@/features/auth/api';
import { useSession } from '@/features/auth/session-store';

export default function EmailStep() {
  const session = useSession();
  const existing = session?.user.email ?? '';
  const [email, setEmail] = useState(existing);
  const [loading, setLoading] = useState(false);
  const next = async () => {
    if (email.trim().toLowerCase() !== existing.toLowerCase()) {
      setLoading(true);
      try { await authApi.updateEmail(email.trim().toLowerCase()); toast.info('Check your inbox to confirm your new email.'); }
      catch (e) { toast.error(e); setLoading(false); return; }
      setLoading(false);
    }
    router.push('/interests');
  };
  return <OnboardingScaffold step={5} title="Your email" body="Add an email for account recovery and important security updates. If you signed up with your phone, you can skip this for now." onNext={next}
    nextLabel={email.trim() ? 'Continue' : 'Continue without email'}
    nextDisabled={!!email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())} loading={loading}>
    <TextField label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
    <Banner tone="info" icon="mail-outline" body="Changing your verified email may require confirmation from both addresses." />
  </OnboardingScaffold>;
}
