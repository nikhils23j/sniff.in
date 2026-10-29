import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';

import { AppHeader, ListGroup, ListRow, Screen, SectionHeader, Text, confirm, toast } from '@/components/ui';
import { authApi } from '@/features/auth/api';
import { env } from '@/lib/env';

export default function SettingsScreen() {
  const [signingOut, setSigningOut] = useState(false);
  const version = Constants.expoConfig?.version ?? '–';
  const signOut = async () => {
    const ok = await confirm({
      title: 'Sign out of Sniff.in?',
      message: 'You can sign back in with your email and password.',
      confirmLabel: 'Sign out',
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await authApi.signOut();
      // The auth listener clears the session and returns the app to the welcome screen.
    } catch (e) {
      toast.error(e);
      setSigningOut(false);
    }
  };

  return (
    <Screen header={<AppHeader title="Settings & privacy" />} edges={['top', 'bottom']}>
      <SectionHeader title="Your profile" />
      <ListGroup>
        <ListRow icon="person-outline" title="Edit profile & personal details" subtitle="Name, bio, work, study and hometown" onPress={() => router.push('/profile/edit')} />
        <ListRow icon="images-outline" title="Photos & prompts" onPress={() => router.push('/profile/personality')} />
        <ListRow icon="pricetags-outline" title="Interests" subtitle="What powers your introductions" onPress={() => router.push('/profile/interests')} />
        <ListRow icon="shield-checkmark-outline" title="Verify college or work email" onPress={() => router.push('/profile/verify')} />
      </ListGroup>

      <SectionHeader title="Privacy and safety" />
      <ListGroup>
        <ListRow icon="eye-off-outline" title="Privacy & visibility" subtitle="Who sees each part of your profile" onPress={() => router.push('/settings/privacy')} />
        <ListRow icon="shield-checkmark-outline" title="Safety & discovery" subtitle="Who you can meet" onPress={() => router.push('/settings/safety')} />
        <ListRow icon="ban-outline" title="Blocked people" onPress={() => router.push('/settings/blocked')} />
        <ListRow icon="chatbox-ellipses-outline" title="Endorsements" subtitle="Approve or hide what people wrote" onPress={() => router.push('/settings/endorsements')} />
      </ListGroup>

      <SectionHeader title="App" />
      <ListGroup>
        <ListRow icon="notifications-outline" title="Notifications" onPress={() => router.push('/settings/notifications')} />
        <ListRow icon="server-outline" title="Data & account" subtitle="Your data, deleting your account" onPress={() => router.push('/settings/account')} />
      </ListGroup>

      <SectionHeader title="About" />
      <ListGroup>
        <ListRow icon="chatbox-ellipses-outline" title="Feedback" onPress={() => router.push('/feedback')} />
      </ListGroup>

      <SectionHeader title="Account" />
      <ListGroup>
        <ListRow
          icon="log-out-outline"
          title={signingOut ? 'Signing out…' : 'Sign out'}
          subtitle="Sign out on this phone"
          tone="danger"
          chevron={false}
          disabled={signingOut}
          onPress={signOut}
        />
      </ListGroup>

      <Text variant="caption" color="textTertiary" align="center">
        Sniff.in {version}
        {env.appEnv !== 'production' ? ` · ${env.appEnv} environment` : ''}
      </Text>
    </Screen>
  );
}
