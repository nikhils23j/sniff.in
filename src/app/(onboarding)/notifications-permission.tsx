import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useState } from 'react';

import { OnboardingScaffold } from '@/components/OnboardingScaffold';
import { Banner, toast } from '@/components/ui';

export default function NotificationsStep() {
  const [loading, setLoading] = useState(false);
  const request = async () => {
    setLoading(true);
    try { await Notifications.requestPermissionsAsync(); router.push('/identity'); }
    catch (e) { toast.error(e); } finally { setLoading(false); }
  };
  return <OnboardingScaffold step={2} title="Stay in the loop" body="Get updates for connection requests, messages, activities, and your Servers."
    onNext={request} nextLabel="Allow notifications" loading={loading} skipTo="/identity">
    <Banner tone="accent" icon="notifications-outline" body="You can choose which notifications you receive in Settings at any time." />
  </OnboardingScaffold>;
}
