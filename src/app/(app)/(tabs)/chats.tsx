import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Button, CountBadge, EmptyState, ErrorState, IconButton, LoadingList, SegmentedControl, Text, TextField, confirm, toast } from '@/components/ui';
import { useUserId } from '@/features/auth/session-store';
import { useMe } from '@/features/profile/hooks';
import { compactAgo, relativeTime, useHideConversation } from '@/features/social/chat-extra';
import { useChatNotes, useClearChatNote, useConversations, usePendingRequestCount, useSetChatNote } from '@/features/social/hooks';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { useTheme } from '@/theme';
import type { ChatNote, ConversationSummary } from '@/types/domain';

function NoteBubble({ note, mine, myAvatar, myName, onPress }: { note?: ChatNote; mine?: boolean; myAvatar?: string | null; myName?: string | null; onPress: () => void }) {
  const t = useTheme();
  const caption = note?.song_title ? `♫ ${note.song_title}` : note?.body || (mine ? 'Write your thoughts' : '');
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={mine ? 'Write or edit your note' : `${note?.user.display_name}'s note: ${caption}`}
    style={{ width: 112, alignItems: 'center', gap: 6 }}>
    <View style={{ position: 'relative' }}><Avatar path={note?.user.avatar_path ?? (mine ? myAvatar : null)} name={note?.user.display_name ?? (mine ? myName || 'You' : '')} size={58} />
      {mine ? <View style={{ position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: t.colors.primary, borderWidth: 2, borderColor: t.colors.background, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="add" color="white" size={15} /></View> : null}
    </View>
    <View style={{ minHeight: 40, maxWidth: 110, justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface }}>
      <Text variant="micro" align="center" numberOfLines={2}>{caption}</Text>
    </View>
  </Pressable>;
}

function ConversationRow({ item, myId, onLongPress }: { item: ConversationSummary; myId: string | null; onLongPress: () => void }) {
  const t = useTheme(); const unread = Number(item.unread_count || 0); const mine = item.last_sender_id === myId;
  const preview = item.last_message ? `${mine ? 'You: ' : ''}${item.last_message}` : 'Say hello. Your chat is open.';
  return <Pressable onPress={() => router.push(`/chat/${item.conversation_id}`)} onLongPress={onLongPress}
    accessibilityLabel={`Chat with ${item.other.display_name}`} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 10, opacity: pressed ? 0.65 : 1 })}>
    <Avatar path={item.other.avatar_path} name={item.other.display_name} size={56} />
    <View style={{ flex: 1, gap: 3 }}><View style={{ flexDirection: 'row', gap: 8 }}><Text variant="subheading" numberOfLines={1} style={{ flex: 1 }}>{item.other.display_name}</Text><Text variant="micro" color="textTertiary">{item.last_message ? compactAgo(item.last_message_at) : ''}</Text></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text variant="callout" color={unread ? 'text' : 'textSecondary'} numberOfLines={1} style={{ flex: 1, fontWeight: unread ? '700' : '400' }}>{preview}</Text><CountBadge count={unread} /></View>
      {item.expires_at && !item.is_friend ? <Text variant="micro" style={{ color: t.colors.warning }}>Disappears {relativeTime(item.expires_at)}</Text> : null}
    </View>
  </Pressable>;
}

function NoteEditor({ visible, note, onClose }: { visible: boolean; note?: ChatNote; onClose: () => void }) {
  const t = useTheme();
  const [kind, setKind] = useState<'text' | 'song'>(note?.song_title ? 'song' : 'text'); const [body, setBody] = useState(note?.body ?? '');
  const [title, setTitle] = useState(note?.song_title ?? ''); const [artist, setArtist] = useState(note?.song_artist ?? '');
  const save = useSetChatNote(); const clear = useClearChatNote();
  const submit = () => save.mutate({ body: kind === 'text' ? body.trim() : null, songTitle: kind === 'song' ? title.trim() : null, songArtist: kind === 'song' ? artist.trim() : null, songUrl: null }, { onSuccess: () => { toast.success('Note shared for 24 hours'); onClose(); }, onError: toast.error });
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><View style={{ flex: 1, padding: 24, gap: 18, backgroundColor: t.colors.background }}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text variant="title" style={{ flex: 1 }}>Your note</Text><IconButton icon="close" label="Close" onPress={onClose} /></View>
    <SegmentedControl value={kind} onChange={setKind} options={[{ value: 'text', label: 'Thought' }, { value: 'song', label: 'Song' }]} />
    {kind === 'text' ? <TextField label="Share a thought" value={body} onChangeText={setBody} maxCount={80} multiline placeholder="What’s on your mind?" /> : <><TextField label="Song" value={title} onChangeText={setTitle} maxCount={100} placeholder="Song title" /><TextField label="Artist" value={artist} onChangeText={setArtist} maxCount={100} /></>}
    <Button title="Share note" loading={save.isPending} disabled={kind === 'text' ? !body.trim() : !title.trim()} onPress={submit} />
    {note ? <Button title="Remove note" variant="ghost" loading={clear.isPending} onPress={() => clear.mutate(undefined, { onSuccess: onClose, onError: toast.error })} /> : null}
  </View></Modal>;
}

export default function ChatsScreen() {
  const t = useTheme(); const insets = useSafeAreaInsets(); const myId = useUserId(); const [query, setQuery] = useState(''); const [editingNote, setEditingNote] = useState(false);
  const conversations = useConversations(); const notes = useChatNotes(); const me = useMe(); const incoming = usePendingRequestCount('incoming'); const hide = useHideConversation();
  const list = useMemo(() => (conversations.data?.pages.flat() ?? []).filter((c) => c.other.display_name.toLowerCase().includes(query.trim().toLowerCase())), [conversations.data?.pages, query]);
  const mine = notes.data?.find((n) => n.user.id === myId); const others = notes.data?.filter((n) => n.user.id !== myId) ?? [];
  const pull = usePullRefresh(() => Promise.all([conversations.refetch(), notes.refetch()])); const count = incoming.data ?? 0;
  const confirmHide = async (item: ConversationSummary) => { if (await confirm({ title: `Hide chat with ${item.other.display_name}?`, message: 'It returns if they message again.', confirmLabel: 'Hide', destructive: true })) hide.mutate(item.conversation_id, { onError: toast.error }); };
  const empty = conversations.isLoading ? <LoadingList count={4} /> : conversations.isError ? <ErrorState error={conversations.error} onRetry={() => conversations.refetch()} /> : <EmptyState icon="chatbubbles-outline" title="No chats yet" body="Available people and accepted requests appear here." />;
  return <View style={{ flex: 1, backgroundColor: t.colors.background, paddingTop: insets.top }}>
    <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 13 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text variant="title" style={{ flex: 1 }}>Chats</Text><IconButton icon="mail-unread-outline" label="Message requests" badge={count} onPress={() => router.push('/requests')} /><IconButton icon="create-outline" label="New message" onPress={() => router.push('/new-message')} /></View>
      <FlatList horizontal data={others} keyExtractor={(n) => n.user.id} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}
        ListHeaderComponent={<NoteBubble note={mine} mine myAvatar={me.data?.avatar_path} myName={me.data?.display_name} onPress={() => setEditingNote(true)} />}
        renderItem={({ item }) => <NoteBubble note={item} onPress={() => router.push(`/user/${item.user.id}`)} />} />
      <TextField value={query} onChangeText={setQuery} placeholder="Search messages" accessibilityLabel="Search messages" />
    </View>
    <FlatList data={list} keyExtractor={(c) => c.conversation_id} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 8, paddingBottom: 40 }} renderItem={({ item }) => <ConversationRow item={item} myId={myId} onLongPress={() => void confirmHide(item)} />} ListEmptyComponent={empty} refreshControl={<RefreshControl tintColor={t.colors.primary} {...pull} />} />
    <NoteEditor key={mine?.expires_at ?? 'empty-note'} visible={editingNote} note={mine} onClose={() => setEditingNote(false)} />
  </View>;
}
