import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ServerAvatar } from '@/components/ServerAvatar';
import { ServerManagementPanel } from '@/components/ServerManagementPanel';
import { AppHeader, Banner, Button, Card, ListGroup, ListRow, Screen, SectionHeader, SwitchRow, Tag, Text, TextField, confirm, toast } from '@/components/ui';
import { useLeaveServer, useSetDiscoverable, useSetServerProfile } from '@/features/servers/hooks';
import type { ServerDetail } from '@/types/domain';

export function ServerMemberSettings({ server }: { server: ServerDetail }) {
  const id = server.id;
  const membership = server.membership;
  const active = membership?.status === 'active';
  const discoverable = useSetDiscoverable(id);
  const profile = useSetServerProfile(id);
  const leave = useLeaveServer();
  const [note, setNote] = useState<string | null>(null);

  const saveNote = () => profile.mutate(
    { mode: 'both', note: (note ?? membership?.member_note ?? '').trim() || null },
    { onSuccess: () => { setNote(null); toast.success('Saved for this Server'); }, onError: toast.error },
  );

  const onLeave = async () => {
    const ok = await confirm({
      title: `Leave ${server.name}?`,
      message: "You'll stop appearing here and lose access to its activity. You can rejoin later if the Server allows it.",
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    leave.mutate(id, {
      onSuccess: () => { toast.success(`You left ${server.name}`); router.dismissTo('/(tabs)/servers'); },
      onError: toast.error,
    });
  };

  return (
    <Screen header={<AppHeader title="Server settings" subtitle={server.name} />} edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <ServerAvatar name={server.name} category={server.category} avatarPath={server.avatar_path} size={56} />
        <View style={{ flex: 1, gap: 5 }}>
          <Text variant="subheading" numberOfLines={2}>{server.name}</Text>
          <Tag small tone={active ? 'accent' : 'warning'}
            label={active ? (membership?.role === 'moderator' ? 'Moderator' : 'Member')
              : membership?.status === 'pending' ? 'Awaiting approval' : 'Removed'} />
        </View>
      </View>

      {!server.is_live ? <Banner tone="warning" body="This Server has ended. Its chat and invites are read-only." /> : null}
      {server.can_manage && active ? <ServerManagementPanel server={server} /> : null}

      <SectionHeader title="Your settings" />
      <ListGroup>
        {active && server.is_live ? (
          <SwitchRow icon="eye-outline" title="Visible in this Server"
            subtitle="When off, you're hidden here even while Available, and you can't browse people here either."
            value={membership?.discoverable ?? false} disabled={discoverable.isPending}
            onValueChange={(value) => discoverable.mutate(value, { onError: toast.error })} />
        ) : null}
        {active && server.kind === 'short_term' && server.is_live ? (
          <ListRow icon="chatbubbles-outline" title="Open to Talk here"
            subtitle="Change your availability, topic and visit duration"
            onPress={() => router.push(`/server/${id}/presence`)} />
        ) : null}
        <ListRow icon="information-circle-outline" title="Server info"
          subtitle="About this Server and your membership"
          onPress={() => router.push(`/server/${id}/details`)} />
        {active ? (
          <ListRow icon="people-outline" title="Member directory"
            subtitle="See who's part of this Server"
            onPress={() => router.push(`/server/${id}/directory`)} />
        ) : null}
      </ListGroup>

      {active && server.kind === 'long_term' && server.member_field_label ? (
        <Card style={{ gap: 12 }}>
          <Text variant="subheading">Your member info</Text>
          <TextField label={`${server.member_field_label} (optional)`}
            placeholder={server.member_field_hint ?? undefined}
            hint="Only members of this Server see it, next to your name in the directory."
            value={note ?? membership?.member_note ?? ''} onChangeText={setNote} maxCount={100} />
          <Button title="Save" size="sm" variant="secondary" loading={profile.isPending}
            disabled={note === null || note.trim() === (membership?.member_note ?? '')}
            onPress={saveNote} />
        </Card>
      ) : null}

      {active ? <Button title="Leave Server" variant="danger" icon="exit-outline" loading={leave.isPending} onPress={onLeave} /> : null}
      {membership?.status === 'pending' ? (
        <Button title="Cancel request" variant="secondary" loading={leave.isPending}
          onPress={() => leave.mutate(id, {
            onSuccess: () => { toast.info('Request cancelled'); router.dismissTo('/(tabs)/servers'); },
            onError: toast.error,
          })} />
      ) : null}
    </Screen>
  );
}
