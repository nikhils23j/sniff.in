import Ionicons from '@expo/vector-icons/Ionicons';
import { formatDistanceToNow } from 'date-fns';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import {
  AppHeader, Banner, Button, Card, EmptyState, ErrorState, LoadingList, Screen, SectionHeader, Tag, TagList, Text, TextField, confirm,
  toast,
} from '@/components/ui';
import { useCreateToken, useJoinTokens, useRevokeToken, useServer } from '@/features/servers/hooks';
import { serverInviteUrl } from '@/features/servers/invite-link';
import { formatDateTime } from '@/features/servers/presets';
import { useTheme } from '@/theme';
import type { JoinToken } from '@/types/domain';
import { useNow } from '@/hooks/use-now';

type Kind = JoinToken['kind'];

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'qr', label: 'QR code', hint: 'Print or project it at the entrance.' },
  { value: 'link', label: 'Link', hint: 'Share in a group chat or email.' },
  { value: 'code', label: '8-character code', hint: 'Easy to read out loud or type.' },
];
const EXPIRY: { label: string; minutes: number | null }[] = [
  { label: 'Never', minutes: null },
  { label: '1 hour', minutes: 60 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
  { label: '30 days', minutes: 43200 },
];

/** 8-character codes read aloud best in two groups of four: "ABCD 2345". */
const formatCode = (token: string) => (token.length === 8 ? `${token.slice(0, 4)} ${token.slice(4)}` : token);

function tokenState(t: JoinToken): 'active' | 'revoked' | 'expired' | 'used_up' {
  if (t.revoked_at) return 'revoked';
  if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now()) return 'expired';
  if (t.max_uses != null && t.use_count >= t.max_uses) return 'used_up';
  return 'active';
}
const STATE_LABEL = { active: 'Active', revoked: 'Revoked', expired: 'Expired', used_up: 'Fully used' } as const;
const KIND_LABEL: Record<Kind, string> = { qr: 'QR code', link: 'Link', code: 'Code' };

export default function InvitesScreen() {
  const now = useNow();
  const { colors, radius } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const server = useServer(id);
  // Adding members is an admin power: only admins create or revoke invites (enforced by create_join_token).
  const isAdmin = server.data?.is_admin === true;
  const tokens = useJoinTokens(isAdmin ? id : '');
  const create = useCreateToken(id);
  const revoke = useRevokeToken(id);

  const [kind, setKind] = useState<Kind>('qr');
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [maxUses, setMaxUses] = useState('');
  const [label, setLabel] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = tokens.data ?? [];
  const selected = useMemo(() => list.find((t) => t.id === selectedId) ?? null, [list, selectedId]);
  // Select the newest active token by default so admins immediately see a QR.
  useEffect(() => {
    if (!selectedId && list.length) {
      const firstActive = list.find((t) => tokenState(t) === 'active');
      if (firstActive) setSelectedId(firstActive.id);
    }
  }, [list, selectedId]);

  if (server.isLoading) {
    return (
      <Screen header={<AppHeader title="Invites & QR" />}>
        <LoadingList count={2} />
      </Screen>
    );
  }
  if (server.isError || !server.data) {
    return (
      <Screen header={<AppHeader title="Invites & QR" />}>
        <ErrorState error={server.error} onRetry={server.refetch} />
      </Screen>
    );
  }
  const s = server.data;
  if (!s.is_admin) {
    return (
      <Screen header={<AppHeader title="Invites & QR" />}>
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          body={s.can_manage
            ? 'Adding members is an admin role, so only admins create QR codes and invites. Ask an admin of this Server if you need one.'
            : "Only this Server's admins can create invites. Ask an admin for the QR code or invite code."}
        />
      </Screen>
    );
  }

  const parsedMax = maxUses.trim() === '' ? null : Number.parseInt(maxUses, 10);
  const maxInvalid = parsedMax !== null && (!Number.isFinite(parsedMax) || parsedMax < 1);

  const onCreate = () => {
    if (maxInvalid) return toast.error('Max uses must be a number of at least 1');
    create.mutate(
      { kind, expiresMinutes: EXPIRY[expiryIdx].minutes, maxUses: parsedMax, label: label.trim() || null },
      {
        onSuccess: (t) => {
          setSelectedId(t.id);
          setLabel('');
          setMaxUses('');
          toast.success('Invite created');
        },
        onError: toast.error,
      },
    );
  };

  const copy = async (text: string, what: string) => {
    try {
      await Clipboard.setStringAsync(text);
      toast.success(`${what} copied`);
    } catch (e) {
      toast.error(e);
    }
  };

  const share = async (t: JoinToken) => {
    try {
      await Share.share({
        message: t.kind === 'code'
          ? `Join ${s.name} on Sniff.in: ${serverInviteUrl(t.token)} (or enter code ${t.token} in the app)`
          : `Join ${s.name} on Sniff.in: ${serverInviteUrl(t.token)}`,
      });
    } catch (e) {
      toast.error(e);
    }
  };

  const onRevoke = async (t: JoinToken) => {
    const ok = await confirm({
      title: 'Revoke this invite?',
      message: 'Anyone who has it will no longer be able to join with it. People who already joined stay members.',
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
    revoke.mutate(t.id, { onSuccess: () => toast.success('Invite revoked'), onError: toast.error });
  };

  const active = selected && tokenState(selected) === 'active';

  return (
    <Screen
      header={<AppHeader title="Invites & QR" subtitle={s.name} />}
      edges={['top', 'bottom']}
      onRefresh={() => tokens.refetch()}
      refreshing={tokens.isRefetching}>
      {!s.is_live ? <Banner tone="warning" body="This Server has ended or is archived, so new invites can't be created." /> : null}

      {selected ? (
        <Card style={{ gap: 14, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="subheading" numberOfLines={1} style={{ flex: 1 }}>
              {selected.label || KIND_LABEL[selected.kind]}
            </Text>
            <Tag label={STATE_LABEL[tokenState(selected)]} tone={active ? 'accent' : 'warning'} small />
          </View>
          {/* QR codes must stay black on white to scan reliably (and print well), regardless of theme. */}
          <View
            accessibilityLabel={`QR code to join ${s.name}`}
            style={{ backgroundColor: '#FFFFFF', padding: 20, borderRadius: radius.xl, opacity: active ? 1 : 0.25 }}>
            <QRCode value={serverInviteUrl(selected.token)} size={240} color="#000000" backgroundColor="#FFFFFF" />
          </View>
          {selected.kind === 'code' ? (
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text variant="caption" color="textSecondary">
                Invite code
              </Text>
              <Text
                selectable
                accessibilityLabel={`Invite code ${selected.token.split('').join(', ')}`}
                style={{ fontSize: 38, lineHeight: 46, letterSpacing: 5, fontFamily: 'Courier', fontWeight: '700', color: colors.text }}>
                {formatCode(selected.token)}
              </Text>
              <Text variant="caption" color="textTertiary">
                Letters and digits only, no spaces needed
              </Text>
            </View>
          ) : null}
          <Text variant="caption" color="textSecondary" align="center">
            {selected.use_count} join{selected.use_count === 1 ? '' : 's'}
            {selected.max_uses != null ? ` of ${selected.max_uses}` : ''} ·{' '}
            {selected.expires_at ? `${new Date(selected.expires_at).getTime() > now ? 'expires' : 'expired'} ${formatDateTime(selected.expires_at)}` : 'never expires'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
            <Button title="Copy link" size="sm" variant="secondary" icon="copy-outline" style={{ flex: 1 }} disabled={!active} onPress={() => copy(serverInviteUrl(selected.token), 'Link')} />
            {selected.kind === 'code' ? (
              <Button title="Copy code" size="sm" variant="secondary" icon="keypad-outline" style={{ flex: 1 }} disabled={!active} onPress={() => copy(selected.token, 'Code')} />
            ) : null}
            <Button title="Share" size="sm" icon="share-outline" style={{ flex: 1 }} disabled={!active} onPress={() => share(selected)} />
          </View>
          <Text variant="caption" color="textTertiary" align="center">
            Links open in the Sniff.in app; install the app first.
          </Text>
          {active ? (
            <Button title="Revoke invite" variant="danger" size="sm" icon="ban-outline" loading={revoke.isPending} onPress={() => onRevoke(selected)} />
          ) : null}
        </Card>
      ) : null}

      <Banner
        tone="info"
        icon="shield-checkmark-outline"
        title="QR codes are checked by Sniff.in"
        body={
          s.kind === 'short_term'
            ? 'Every scan is validated on the server and you can revoke any invite at any time. For a train, bar or event, create a short-lived QR per session so old screenshots stop working. Invites can never outlast the event.'
            : 'Every scan is validated on the server and you can revoke any invite at any time. For shared spaces, create short-lived QR codes and rotate them so old screenshots stop working.'
        }
      />

      <View style={{ gap: 12 }}>
        <SectionHeader title="Create an invite" />
        <Card style={{ gap: 14 }}>
          <View style={{ gap: 8 }}>
            <Text variant="caption" color="textSecondary">
              Type
            </Text>
            <TagList>
              {KINDS.map((k) => (
                <Tag key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(k.value)} />
              ))}
            </TagList>
            <Text variant="caption" color="textTertiary">
              {KINDS.find((k) => k.value === kind)?.hint}
            </Text>
          </View>
          <View style={{ gap: 8 }}>
            <Text variant="caption" color="textSecondary">
              Expires
            </Text>
            <TagList>
              {EXPIRY.map((e, i) => (
                <Tag key={e.label} label={e.label} selected={expiryIdx === i} onPress={() => setExpiryIdx(i)} />
              ))}
            </TagList>
            {s.kind === 'short_term' && s.ends_at ? (
              <Text variant="caption" color="textTertiary">
                Event invites stop working when the event ends ({formatDateTime(s.ends_at)}).
              </Text>
            ) : null}
          </View>
          <TextField
            label="Max uses (optional)"
            placeholder="Unlimited"
            keyboardType="number-pad"
            value={maxUses}
            onChangeText={(v) => setMaxUses(v.replace(/[^0-9]/g, ''))}
            error={maxInvalid ? 'Enter a number of at least 1' : undefined}
          />
          <TextField label="Label (optional)" placeholder="Front door, Coach B3, Staff…" maxCount={40} value={label} onChangeText={setLabel} />
          <Button title="Create invite" icon="add-circle-outline" loading={create.isPending} disabled={!s.is_live || maxInvalid} onPress={onCreate} />
        </Card>
      </View>

      <View style={{ gap: 10 }}>
        <SectionHeader title="All invites" />
        {tokens.isLoading ? (
          <LoadingList count={2} />
        ) : tokens.isError ? (
          <ErrorState compact error={tokens.error} onRetry={tokens.refetch} />
        ) : list.length === 0 ? (
          <EmptyState compact icon="qr-code-outline" title="No invites yet" body="Create a QR code, link or code above to let people in." />
        ) : (
          list.map((t) => {
            const st = tokenState(t);
            const isSel = t.id === selectedId;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel }}
                accessibilityLabel={`${t.label || KIND_LABEL[t.kind]}, ${STATE_LABEL[st]}, ${t.use_count} uses`}
                onPress={() => setSelectedId(t.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: isSel ? 1.5 : 1,
                  borderColor: isSel ? colors.primary : colors.border, backgroundColor: colors.surface, opacity: st === 'active' ? 1 : 0.7,
                }}>
                <Ionicons name={t.kind === 'qr' ? 'qr-code-outline' : t.kind === 'link' ? 'link-outline' : 'keypad-outline'} size={22} color={colors.primary} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="callout" numberOfLines={1}>
                    {t.label || KIND_LABEL[t.kind]}
                  </Text>
                  <Text variant="caption" color="textSecondary" numberOfLines={1}>
                    {t.use_count}
                    {t.max_uses != null ? `/${t.max_uses}` : ''} uses ·{' '}
                    {t.revoked_at
                      ? `revoked ${formatDistanceToNow(new Date(t.revoked_at), { addSuffix: true })}`
                      : t.expires_at
                        ? `${st === 'expired' ? 'expired' : 'expires'} ${formatDistanceToNow(new Date(t.expires_at), { addSuffix: true })}`
                        : 'no expiry'}
                  </Text>
                </View>
                <Tag label={STATE_LABEL[st]} small tone={st === 'active' ? 'accent' : 'warning'} />
              </Pressable>
            );
          })
        )}
      </View>
    </Screen>
  );
}
