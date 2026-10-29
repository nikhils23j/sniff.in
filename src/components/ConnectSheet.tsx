import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Button, Text, TextField, toast } from '@/components/ui';
import { useSendRequest } from '@/features/social/hooks';
import { useTheme } from '@/theme';
import type { MiniCard } from '@/types/domain';

/** Send a connection request with an optional short intro. Mutual accept opens chat. */
export function ConnectSheet({
  person, serverId, serverName, visible, onClose,
}: { person: Pick<MiniCard, 'id' | 'display_name' | 'avatar_path'> | null; serverId: string; serverName?: string; visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const send = useSendRequest();

  const submit = async () => {
    if (!person) return;
    try {
      const res = await send.mutateAsync({ recipient: person.id, serverId, message: message.trim() || null });
      setMessage('');
      onClose();
      if (res.status === 'accepted') {
        toast.success(`You and ${person.display_name} are connected!`);
        router.push(`/chat/${res.conversation_id}`);
      } else {
        toast.success(`Request sent to ${person.display_name}`);
      }
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: t.colors.overlay }} onPress={onClose} />
        <View style={{ backgroundColor: t.colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: insets.bottom + 20, gap: 16 }}>
          {person ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar path={person.avatar_path} name={person.display_name} size={44} />
              <View style={{ flex: 1 }}>
                <Text variant="heading">Connect with {person.display_name.split(' ')[0]}</Text>
                {serverName ? (
                  <Text variant="caption" color="textSecondary">
                    via {serverName}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
          <TextField
            label="Add a short intro (optional)"
            placeholder="Hey! Saw we both play badminton. Up for a game later?"
            value={message}
            onChangeText={setMessage}
            multiline
            maxCount={280}
          />
          <Text variant="caption" color="textTertiary">
            If they accept, a private chat opens and you&apos;ll both see each other&apos;s connections-only details.
          </Text>
          <Button title="Send request" icon="paper-plane" size="lg" loading={send.isPending} onPress={submit} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
