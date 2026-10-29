import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';

import {
  AppHeader, Banner, Button, ErrorState, ListGroup, LoadingList, Screen, SectionHeader, SwitchRow, Text, toast,
} from '@/components/ui';
import { getPermissionStatus, registerIfPermitted, requestPushPermission } from '@/features/notifications/push';
import { useMySettings, useUpdateSettings } from '@/features/profile/hooks';
import type { UserSettings } from '@/types/domain';

type NotifKey = 'notify_requests' | 'notify_messages' | 'notify_activity' | 'notify_servers' | 'notify_announcements' | 'push_previews';

const ROWS: { key: NotifKey; icon: React.ComponentProps<typeof SwitchRow>['icon']; title: string; subtitle: string }[] = [
  { key: 'notify_requests', icon: 'mail-outline', title: 'Connection requests', subtitle: 'When someone wants to connect, or accepts your request.' },
  { key: 'notify_messages', icon: 'chatbubble-outline', title: 'Messages', subtitle: 'New messages in your chats.' },
  { key: 'notify_activity', icon: 'megaphone-outline', title: 'Activity', subtitle: 'Responses to your posts.' },
  { key: 'notify_servers', icon: 'people-outline', title: 'Servers', subtitle: 'Approvals, badges and moderation updates.' },
  { key: 'notify_announcements', icon: 'notifications-outline', title: 'Announcements', subtitle: 'Messages from your Servers’ admins.' },
];

type Perm = 'granted' | 'denied' | 'undetermined' | 'unknown';

export default function NotificationSettingsScreen() {
  const settings = useMySettings();
  const update = useUpdateSettings();
  const [perm, setPerm] = useState<Perm>('unknown');
  const [enabling, setEnabling] = useState(false);

  const refresh = useCallback(() => {
    getPermissionStatus().then(
      (s) => setPerm(s === 'granted' || s === 'denied' ? s : 'undetermined'),
      () => setPerm('unknown'),
    );
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const change = (patch: Partial<UserSettings>) => update.mutate(patch, { onError: toast.error });

  const enable = async () => {
    setEnabling(true);
    try {
      if (perm === 'denied') {
        await Linking.openSettings();
        return;
      }
      const granted = await requestPushPermission();
      refresh();
      if (!granted) {
        toast.info('Push notifications stay off. You can change this in your phone settings.');
        return;
      }
      await registerIfPermitted();
      toast.success('Push notifications enabled on this device');
    } catch (e) {
      toast.error(e);
    } finally {
      setEnabling(false);
    }
  };

  let body: React.ReactNode;
  if (settings.isLoading) body = <LoadingList count={2} />;
  else if (settings.isError || !settings.data) body = <ErrorState error={settings.error ?? new Error('unknown')} onRetry={() => { settings.refetch(); }} />;
  else {
    const s = settings.data;
    body = (
      <>
        <SectionHeader title="What to notify me about" />
        <ListGroup>
          {ROWS.map((r) => (
            <SwitchRow key={r.key} icon={r.icon} title={r.title} subtitle={r.subtitle} value={s[r.key]} onValueChange={(v) => change({ [r.key]: v })} />
          ))}
        </ListGroup>
        <Text variant="caption" color="textTertiary">
          These apply to in-app notifications and push alike.
        </Text>

        <SectionHeader title="Privacy on your lock screen" />
        <ListGroup>
          <SwitchRow
            icon="eye-outline"
            title="Show names in push notifications"
            subtitle="Off by default. Push messages say &ldquo;You have a new message&rdquo; without a name or text, so nothing sensitive shows on a locked screen."
            value={s.push_previews}
            onValueChange={(v) => change({ push_previews: v })}
          />
        </ListGroup>
      </>
    );
  }

  return (
    <Screen header={<AppHeader title="Notifications" />} edges={['top', 'bottom']}>
      <Banner
        tone={perm === 'granted' ? 'success' : 'info'}
        icon={perm === 'granted' ? 'checkmark-circle' : 'notifications-off-outline'}
        title={perm === 'granted' ? 'Push permission is on' : perm === 'denied' ? 'Push permission is blocked' : 'Push notifications are off'}
        body={
          perm === 'granted'
            ? 'This device is allowed to show notifications. Push also needs a configured app build; if it is not set up yet, in-app notifications still work.'
            : perm === 'denied'
              ? 'Notifications are blocked for Sniff.in in your phone settings. Open settings to allow them. In-app notifications keep working either way.'
              : 'Allow notifications to hear about requests and messages when the app is closed. In-app notifications work without this.'
        }
      />
      {perm !== 'granted' ? (
        <Button
          title={perm === 'denied' ? 'Open phone settings' : 'Enable push notifications'}
          icon="notifications-outline"
          loading={enabling}
          onPress={enable}
        />
      ) : (
        <Button title="Re-register this device" variant="secondary" size="sm" loading={enabling} onPress={enable} />
      )}
      {body}
    </Screen>
  );
}
