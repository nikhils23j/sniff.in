import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';

import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { Banner, toast } from '@/components/ui';

export default function LocationStep() {
  const [loading, setLoading] = useState(false);
  const request = async () => {
    setLoading(true);
    try {
      await Location.requestForegroundPermissionsAsync();
      router.push('/notifications-permission');
    } catch (e) { toast.error(e); } finally { setLoading(false); }
  };
  return <OnboardingScaffold step={1} back={false} title="Find what’s around you" body="Location helps surface nearby temporary Servers and activities while you use the app."
    onNext={request} nextLabel="Allow location" loading={loading} skipTo="/notifications-permission">
    <Banner tone="info" icon="location-outline" title="You stay in control" body="Sniff.in requests foreground access only. Your precise location is never displayed on your profile." />
  </OnboardingScaffold>;
}
