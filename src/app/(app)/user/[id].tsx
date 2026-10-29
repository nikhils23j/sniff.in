import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionMenu } from '@/components/ActionMenu';
import { ConnectSheet } from '@/components/ConnectSheet';
import { ProfileBody } from '@/components/ProfileBody';
import {
  AppHeader, Banner, Button, Card, EmptyState, ErrorState, IconButton, Screen, Skeleton, Text, TextField, confirm, toast,
} from '@/components/ui';
import { useProfile, useWriteEndorsement } from '@/features/profile/hooks';
import {
  useBlockUser, useCancelRequest, useRateConnection, useRespondToRequest, useSaveConnection,
} from '@/features/social/hooks';
import { toAppError } from '@/lib/errors';
import { useTheme } from '@/theme';
import type { ProfileView } from '@/types/domain';

function EndorseSheet({
  name, visible, onClose, userId,
}: { name: string; visible: boolean; onClose: () => void; userId: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [body, setBody] = useState('');
  const write = useWriteEndorsement();
  const trimmed = body.trim();
  const valid = trimmed.length >= 10 && trimmed.length <= 500;

  const submit = async () => {
    if (!valid) return;
    try {
      await write.mutateAsync({ userId, body: trimmed });
      setBody('');
      onClose();
      toast.success(`Sent. ${name.split(' ')[0]} will review it before it appears on their profile.`);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: t.colors.overlay }} onPress={onClose} />
        <View style={{ backgroundColor: t.colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: insets.bottom + 20, gap: 14 }}>
          <Text variant="heading">Endorse {name.split(' ')[0]}</Text>
          <TextField
            label="What's it like to know or work with them?"
            placeholder="Thoughtful, reliable, and always up for a game of badminton."
            value={body}
            onChangeText={setBody}
            multiline
            maxCount={500}
            hint={trimmed.length > 0 && trimmed.length < 10 ? 'Write at least 10 characters.' : undefined}
          />
          <Text variant="caption" color="textTertiary">
            {name.split(' ')[0]} reviews it first. It only appears on their profile if they approve it, and they can hide it any time.
          </Text>
          <Button title="Send endorsement" icon="ribbon-outline" size="lg" disabled={!valid} loading={write.isPending} onPress={submit} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ProfileSkeleton() {
  return (
    <View accessibilityLabel="Loading profile" style={{ alignItems: 'center', gap: 12, paddingTop: 12 }}>
      <Skeleton width={104} height={104} radius={52} />
      <Skeleton width={180} height={22} />
      <Skeleton width={110} height={14} />
      <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 16 }}>
        <Skeleton height={48} radius={14} />
        <Skeleton height={110} radius={20} />
        <Skeleton height={90} radius={20} />
      </View>
    </View>
  );
}

export default function UserProfileScreen() {
  const { id, serverId, serverName } = useLocalSearchParams<{ id: string; serverId?: string; serverName?: string }>();
  const q = useProfile(id, serverId);

  const respond = useRespondToRequest();
  const cancel = useCancelRequest();
  const save = useSaveConnection();
  const block = useBlockUser();
  const rate = useRateConnection();

  const [connectOpen, setConnectOpen] = useState(false);
  const [endorseOpen, setEndorseOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rated, setRated] = useState<1 | -1 | null>(null);

  const error = q.isError ? toAppError(q.error) : null;
  const p: ProfileView | undefined = q.data;
  const first = p?.display_name.split(' ')[0] ?? '';

  const accept = async () => {
    if (!p?.relationship.request_id) return;
    try {
      const res = await respond.mutateAsync({ requestId: p.relationship.request_id, accept: true });
      if (res.status === 'accepted') {
        toast.success(`You and ${first} are connected`);
        router.push(`/chat/${res.conversation_id}`);
      }
    } catch (e) {
      toast.error(e);
    }
  };

  const decline = async () => {
    if (!p?.relationship.request_id) return;
    const ok = await confirm({ title: `Decline ${first}?`, message: "They won't be told who declined, only that the request wasn't accepted.", confirmLabel: 'Decline', destructive: true });
    if (!ok) return;
    try {
      await respond.mutateAsync({ requestId: p.relationship.request_id, accept: false });
      toast.info('Request declined');
    } catch (e) {
      toast.error(e);
    }
  };

  const cancelRequest = async () => {
    if (!p?.relationship.request_id) return;
    const ok = await confirm({ title: 'Cancel this request?', message: `${first} won't be able to accept it anymore.`, confirmLabel: 'Cancel request', destructive: true });
    if (!ok) return;
    try {
      await cancel.mutateAsync(p.relationship.request_id);
      toast.info('Request cancelled');
    } catch (e) {
      toast.error(e);
    }
  };

  const saveAsFriend = async () => {
    if (!p?.relationship.connection_id) return;
    try {
      const res = await save.mutateAsync({ connectionId: p.relationship.connection_id, saved: true });
      toast.success(res.is_friend ? `You and ${first} are now friends` : `Saved. You'll become friends once ${first} saves you too.`);
    } catch (e) {
      toast.error(e);
    }
  };

  const blockUser = async () => {
    if (!p) return;
    const ok = await confirm({
      title: `Block ${p.display_name}?`,
      message: "They won't see you anywhere in Sniff.in or be able to contact you, and any chat closes. You can unblock them in Settings.",
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    try {
      await block.mutateAsync(p.id);
      toast.success(`${p.display_name} is blocked`);
      router.back();
    } catch (e) {
      toast.error(e);
    }
  };

  const giveFeedback = async (rating: 1 | -1) => {
    if (!p) return;
    try {
      await rate.mutateAsync({ userId: p.id, rating });
      setRated(rating);
    } catch (e) {
      toast.error(e);
    }
  };

  const header = (
    <AppHeader
      title={p?.relationship.state === 'self' ? 'Your profile' : 'Profile'}
      right={p && p.relationship.state !== 'self' ? <IconButton icon="ellipsis-horizontal" label="Profile options" onPress={() => setMenuOpen(true)} /> : undefined}
    />
  );

  // ------------------------------------------------------------- states
  if (q.isLoading) {
    return <Screen header={header}><ProfileSkeleton /></Screen>;
  }
  if (error?.code === 'not_found') {
    return (
      <Screen header={header}>
        <EmptyState
          icon="person-outline"
          title="This profile isn't available"
          body="You may no longer be able to see it. Try going back."
          action={{ label: 'Go back', onPress: () => (router.canGoBack() ? router.back() : router.replace('/')) }}
        />
      </Screen>
    );
  }
  if (q.isError || !p) {
    return <Screen header={header}><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  }

  // ------------------------------------------------------------- data
  const rel = p.relationship;
  const connectBusy = respond.isPending || cancel.isPending || save.isPending;
  const sharedServerId = serverId ?? p.server_context?.server_id;
  const sharedServerName = serverName ?? p.server_context?.server_name;

  const actions = rel.state === 'self' ? (
    <View style={{ gap: 10 }}>
      <Banner tone="info" icon="eye-outline" body="This is your profile. Members you aren't connected to don't see fields set to Connections or Only me." />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Edit profile" icon="create-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/profile/edit')} />
        <Button title="Member view" icon="eye-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/profile/preview')} />
      </View>
    </View>
  ) : (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Message" icon="chatbubble-ellipses-outline" style={{ flex: 1 }}
          disabled={rel.state === 'pending_outgoing' || (rel.state === 'none' && !sharedServerId)}
          onPress={() => rel.conversation_id ? router.push(`/chat/${rel.conversation_id}`) : rel.state === 'pending_incoming' ? void accept() : setConnectOpen(true)} />
        <Button title={rel.state === 'connected' ? 'Connected' : rel.state === 'pending_outgoing' ? 'Pending' : rel.state === 'pending_incoming' ? 'Accept' : 'Connect'}
          icon={rel.state === 'connected' ? 'checkmark' : rel.state === 'pending_outgoing' ? 'time-outline' : 'person-add-outline'}
          variant={rel.state === 'connected' || rel.state === 'pending_outgoing' ? 'secondary' : 'primary'} style={{ flex: 1 }}
          disabled={rel.state === 'connected' || rel.state === 'pending_outgoing' || (rel.state === 'none' && !sharedServerId) || connectBusy}
          loading={rel.state === 'pending_incoming' && respond.isPending}
          onPress={() => rel.state === 'pending_incoming' ? void accept() : setConnectOpen(true)} />
      </View>
      {rel.state === 'none' && !sharedServerId ? <Text variant="caption" color="textSecondary">Join a Server together to connect or message.</Text> : null}
      {rel.state === 'pending_outgoing' ? <Button title="Cancel request" variant="ghost" size="sm" loading={cancel.isPending} onPress={cancelRequest} /> : null}
      {rel.state === 'pending_incoming' ? <Button title="Decline request" variant="ghost" size="sm" loading={respond.isPending && respond.variables?.accept === false} onPress={decline} /> : null}
    </View>
  );

  const footer = rel.state === 'connected' ? (
    <>
      {!rel.is_friend ? <Button title="Save as friend" icon="heart-outline" variant="secondary" loading={save.isPending} onPress={saveAsFriend} /> : null}
      <Button title="Write an endorsement" variant="secondary" icon="ribbon-outline" onPress={() => setEndorseOpen(true)} />

      <Card tone="muted" style={{ gap: 10 }}>
        <Text variant="subheading">How was talking to them?</Text>
        <Text variant="caption" color="textSecondary">
          Private. {first} never sees this. It only shapes your own recommendations (a 👎 stops suggesting them to you).
        </Text>
        {rated ? (
          <Text variant="callout" color="textSecondary">
            {rated === 1 ? '👍 Thanks. Noted as a good conversation.' : '👎 Noted. We’ll tune your recommendations.'}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button
            title="👍 Good conversation"
            size="sm"
            variant={rated === 1 ? 'primary' : 'secondary'}
            style={{ flex: 1 }}
            loading={rate.isPending && rate.variables?.rating === 1}
            onPress={() => giveFeedback(1)}
          />
          <Button
            title="👎 Not a fit"
            size="sm"
            variant={rated === -1 ? 'primary' : 'secondary'}
            style={{ flex: 1 }}
            loading={rate.isPending && rate.variables?.rating === -1}
            onPress={() => giveFeedback(-1)}
          />
        </View>
      </Card>
    </>
  ) : null;

  return (
    <Screen header={header} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
      <ProfileBody profile={p} actions={actions} footer={footer} />

      {/* sheets & menus */}
      {rel.state === 'none' && sharedServerId ? (
        <ConnectSheet
          person={{ id: p.id, display_name: p.display_name, avatar_path: p.avatar_path }}
          serverId={sharedServerId}
          serverName={sharedServerName}
          visible={connectOpen}
          onClose={() => setConnectOpen(false)}
        />
      ) : null}
      {rel.state === 'connected' ? <EndorseSheet name={p.display_name} userId={p.id} visible={endorseOpen} onClose={() => setEndorseOpen(false)} /> : null}
      <ActionMenu
        visible={menuOpen}
        title={p.display_name}
        onClose={() => setMenuOpen(false)}
        actions={[
          { label: 'Report', icon: 'flag-outline', onPress: () => router.push({ pathname: '/report', params: { userId: p.id, ...(serverId ? { serverId } : {}) } }) },
          { label: 'Block', icon: 'ban-outline', destructive: true, onPress: blockUser },
        ]}
      />
    </Screen>
  );
}
