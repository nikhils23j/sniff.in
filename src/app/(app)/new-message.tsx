import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ConnectSheet } from '@/components/ConnectSheet';
import { AppHeader, Avatar, EmptyState, ErrorState, LoadingList, Screen, Tag, Text } from '@/components/ui';
import { useAvailableChatPeople } from '@/features/social/hooks';
import { useTheme } from '@/theme';
import type { AvailableChatPerson } from '@/types/domain';
export default function NewMessageScreen() {
  const t = useTheme(); const people = useAvailableChatPeople(); const [selected, setSelected] = useState<AvailableChatPerson | null>(null);
  return <Screen header={<AppHeader title="New message" />}>
    <View style={{ gap: 4 }}><Text variant="heading">Available now</Text><Text variant="callout" color="textSecondary">People who are available and share an active Server with you.</Text></View>
    {people.isLoading ? <LoadingList count={5} /> : people.isError ? <ErrorState error={people.error} onRetry={() => people.refetch()} /> : !people.data?.length ? <EmptyState icon="moon-outline" title="Nobody is available right now" body="Try again later or join a Server to meet its members." /> : people.data.map((person) => <Pressable key={person.user.id} disabled={person.request_state !== 'none'} onPress={() => setSelected(person)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: t.radius.lg, backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface })}>
      <Avatar path={person.user.avatar_path} name={person.user.display_name} size={48} /><View style={{ flex: 1, gap: 3 }}><Text variant="subheading">{person.user.display_name}</Text><Text variant="caption" color="textSecondary">via {person.server_name}</Text></View><Tag small tone={person.request_state === 'none' ? 'accent' : 'neutral'} label={person.request_state === 'none' ? 'Available' : person.request_state === 'outgoing' ? 'Requested' : 'Respond in Requests'} />
    </Pressable>)}
    <ConnectSheet person={selected?.user ?? null} serverId={selected?.server_id ?? ''} serverName={selected?.server_name} visible={!!selected} onClose={() => setSelected(null)} />
  </Screen>;
}
