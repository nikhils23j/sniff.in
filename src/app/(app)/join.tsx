import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { KIND_LABEL } from '@/components/ServerCard';
import { ServerAvatar } from '@/components/ServerAvatar';
import { TalkDurationPicker } from '@/components/TalkDurationPicker';
import { AppHeader, Banner, Button, Card, Screen, SegmentedControl, SwitchRow, Tag, TagList, Text, TextField, toast } from '@/components/ui';
import { useJoinWithToken, useMyVenueSession, usePreviewToken, useSetVenueSession } from '@/features/servers/hooks';
import {
  DEFAULT_TALK_DURATION, formatClock, formatDateTime, minutesUntil, resolveTalkMinutes, type TalkDuration,
} from '@/features/servers/presets';
import { useSelectedServer } from '@/features/servers/selection-store';
import { toAppError } from '@/lib/errors';
import { extractJoinToken } from '@/lib/validation';
import { useTheme } from '@/theme';
import type { JoinPreview } from '@/types/domain';

type Mode = 'scan' | 'manual';
type Valid = Extract<JoinPreview, { status: 'valid' }>;

export default function JoinScreen() {
  const { colors, radius } = useTheme();
  const params = useLocalSearchParams<{ t?: string | string[] }>();
  const linkToken = Array.isArray(params.t) ? params.t[0] : params.t;

  const [mode, setMode] = useState<Mode>('scan');
  const [token, setToken] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [openToTalk, setOpenToTalk] = useState(false);
  const [duration, setDuration] = useState<TalkDuration>(DEFAULT_TALK_DURATION);
  const [topic, setTopic] = useState('');
  const [locationHint, setLocationHint] = useState('');
  const [memberNote, setMemberNote] = useState('');
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const scanLock = useRef(false);

  const [permission, requestPermission] = useCameraPermissions();
  const preview = usePreviewToken();
  const join = useJoinWithToken();
  const selectServer = useSelectedServer((x) => x.select);
  const valid = preview.data?.status === 'valid' ? preview.data : null;
  // Already at this venue (rescan): load my current session so the choices start from it and are applied on Continue.
  const rescanId = valid && valid.kind === 'short_term' && valid.my_status === 'active' ? valid.server_id : '';
  const mySession = useMyVenueSession(rescanId);
  const setVenue = useSetVenueSession(valid?.server_id ?? '');
  if (rescanId && mySession.isSuccess && seededFrom !== rescanId) {
    setSeededFrom(rescanId);
    const cur = mySession.data;
    // my_venue_session only returns a session that hasn't ended.
    if (cur) {
      setOpenToTalk(cur.open_to_talk);
      setTopic(cur.topic ?? '');
      setLocationHint(cur.location_hint ?? '');
    }
  }

  const startPreview = useCallback(
    (tok: string) => {
      setToken(tok);
      setInputError(null);
      join.reset();
      preview.mutate(tok);
    },
    // mutation objects are stable enough for our purposes; reset/mutate identities are stable in TanStack Query v5
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Token coming from a deep link / pending join.
  useEffect(() => {
    if (!linkToken) return;
    const tok = extractJoinToken(`?t=${linkToken}`);
    if (tok) {
      scanLock.current = true;
      startPreview(tok);
    } else {
      setInputError("This link doesn't contain a valid invite.");
    }
  }, [linkToken, startPreview]);

  const reset = () => {
    scanLock.current = false;
    setToken(null);
    setInputError(null);
    setSeededFrom(null);
    setMemberNote('');
    preview.reset();
    join.reset();
  };

  /** Temporary Server: Home shows this venue's people deck. */
  const goToVenue = (serverId: string) => {
    selectServer(serverId);
    router.dismissTo('/discover');
  };

  /** Minutes for set_venue_session: the chosen duration when Open to Talk, else a 2 h visit (both capped by the end). */
  const venueMinutes = (p: Valid): number | null => {
    const cap = minutesUntil(p.ends_at, Date.now());
    if (!openToTalk) return Math.max(1, Math.min(120, cap ?? 120));
    const r = resolveTalkMinutes(duration, cap);
    if ('error' in r) {
      toast.error(r.error);
      return null;
    }
    return r.minutes;
  };

  const onScanned = ({ data }: { data: string }) => {
    if (scanLock.current) return;
    scanLock.current = true;
    const tok = extractJoinToken(data);
    if (!tok) {
      setInputError("That QR code isn't a Sniff.in invite.");
      return;
    }
    startPreview(tok);
  };

  const submitManual = () => {
    // Codes are read aloud as "ABCD 2345", so strip any whitespace before parsing links or codes.
    const tok = extractJoinToken(manual.replace(/\s+/g, ''));
    if (!tok) {
      setInputError('That doesn\'t look like an invite link or an 8-character code.');
      return;
    }
    scanLock.current = true;
    startPreview(tok);
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) setManual(text.trim());
      else toast.info('Your clipboard is empty');
    } catch (e) {
      toast.error(e);
    }
  };

  const doJoin = (p: Valid) => {
    if (!token) return;
    const short = p.kind === 'short_term';
    const minutes = short ? venueMinutes(p) : 120;
    if (minutes === null) return;
    const note = p.kind === 'long_term' && p.member_field_label ? memberNote.trim() || null : null;
    // Profiles are one universal view; the RPC still takes a mode.
    join.mutate({ token, mode: 'both', note, open: short && openToTalk, minutes,
      topic: short && openToTalk ? topic.trim() || null : null,
      locationHint: short && openToTalk ? locationHint.trim() || null : null }, {
      onSuccess: (r) => {
        if (r.status !== 'active') return;
        if (short) {
          toast.success(openToTalk ? `You're Open to Talk at ${p.name}` : `You joined ${p.name}`);
          goToVenue(r.server_id);
        } else {
          toast.success(`You joined ${p.name}`);
          router.replace(`/server/${r.server_id}`);
        }
      },
      onError: (e) => {
        const code = toAppError(e).code;
        // These are explained inline below; avoid double messaging.
        if (code !== 'parent_membership_required' && code !== 'banned') toast.error(e);
      },
    });
  };

  /** Already a member: apply this scan's choices (temporary Server) before opening it. */
  const continueActive = (p: Valid) => {
    if (p.kind !== 'short_term') {
      router.replace(`/server/${p.server_id}`);
      return;
    }
    const minutes = venueMinutes(p);
    if (minutes === null) return;
    setVenue.mutate({ open: openToTalk, minutes, topic: openToTalk ? topic.trim() || null : null,
      locationHint: openToTalk ? locationHint.trim() || null : null }, {
      onSuccess: (r) => {
        toast.success(openToTalk ? `Open to Talk until ${formatClock(r.ends_at)}` : `Welcome back to ${p.name}`);
        goToVenue(p.server_id);
      },
      onError: (e) => {
        // An ended venue can't hold a session; still let them open the Server page.
        if (toAppError(e).code === 'server_closed') router.replace(`/server/${p.server_id}`);
        else toast.error(e);
      },
    });
  };

  const showPreview = !!token;
  const previewData = preview.data;
  const joinResult = join.data;

  // ------------------------------------------------------------------ preview / result body
  let body: React.ReactNode = null;
  if (showPreview) {
    if (preview.isPending) {
      body = (
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 32 }}>
          <Ionicons name="hourglass-outline" size={28} color={colors.primary} />
          <Text variant="callout" color="textSecondary">
            Checking this invite…
          </Text>
        </Card>
      );
    } else if (preview.isError) {
      const code = toAppError(preview.error).code;
      body = (
        <View style={{ gap: 12 }}>
          <Banner tone="danger" title={code === 'rate_limited' ? 'Slow down a little' : "Couldn't check this invite"} body={toAppError(preview.error).message} />
          <Button title="Try again" variant="secondary" icon="refresh" onPress={() => token && startPreview(token)} />
          <Button title="Use a different code" variant="ghost" onPress={reset} />
        </View>
      );
    } else if (previewData?.status === 'invalid') {
      body = (
        <View style={{ gap: 12 }}>
          <Banner tone="danger" title="Invite not valid" body="This code is invalid or has expired." />
          <Button title="Scan or enter another code" variant="secondary" icon="qr-code-outline" onPress={reset} />
        </View>
      );
    } else if (previewData?.status === 'valid') {
      const p = previewData;
      const joinCode = join.isError ? toAppError(join.error).code : null;
      body = (
        <View style={{ gap: 14 }}>
          <Card style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              <ServerAvatar name={p.name} category={p.category} avatarPath={p.avatar_path} size={56} />
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text variant="heading" numberOfLines={2} style={{ flexShrink: 1 }}>
                    {p.name}
                  </Text>
                  {p.is_official ? <Ionicons name="shield-checkmark" size={18} color={colors.primary} accessibilityLabel="Verified organisation" /> : null}
                </View>
                {p.parent_name ? (
                  <Text variant="caption" color="textTertiary">
                    Part of {p.parent_name}
                  </Text>
                ) : null}
              </View>
            </View>
            <TagList>
              <Tag label={KIND_LABEL[p.kind]} tone="brand" small />
              <Tag label={`${p.member_count} member${p.member_count === 1 ? '' : 's'}`} small icon="people-outline" />
              {p.is_official ? <Tag label="Verified by Sniff.in" tone="brand" small icon="shield-checkmark" /> : null}
            </TagList>
            {p.description ? (
              <Text variant="callout" color="textSecondary">
                {p.description}
              </Text>
            ) : null}
            {p.ends_at ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                <Text variant="callout" color="textSecondary">
                  Ends {formatDateTime(p.ends_at)}
                </Text>
              </View>
            ) : null}
          </Card>

          {p.ephemeral_chats ? (
            <Banner
              tone="info"
              icon="chatbubbles-outline"
              body="Chats from this event disappear when it ends unless you both save the connection."
            />
          ) : null}
          {p.join_policy === 'approval' && p.my_status !== 'active' && p.my_status !== 'pending' ? (
            <Banner tone="warning" icon="shield-outline" body="An admin approves new members. You'll be notified when they decide." />
          ) : null}
          {p.requires_parent_membership && p.parent_name && p.my_status !== 'active' ? (
            <Banner tone="info" body={`You need to be a member of ${p.parent_name} to join.`} />
          ) : null}
          {p.kind === 'short_term' && p.my_status !== 'banned' && p.my_status !== 'pending' ? (
            <Card style={{ gap: 12 }}>
              <SwitchRow
                icon="chatbubbles-outline"
                title="Be Open to Talk here?"
                subtitle="Members at this venue can see your profile, topic and how to find you. It switches off automatically."
                value={openToTalk}
                onValueChange={setOpenToTalk}
              />
              {openToTalk ? (
                <>
                  <TalkDurationPicker value={duration} onChange={setDuration} endsAt={p.ends_at} />
                  <TextField label="What do you want to talk about?" value={topic} onChangeText={setTopic}
                    maxCount={140} placeholder="Coffee, music, a quick chat…" />
                  <TextField label="How to find you (optional)" value={locationHint} onChangeText={setLocationHint}
                    maxCount={100} placeholder="Find me at table 18" hint="e.g. “I'm across the hallway at the last table.”" />
                </>
              ) : (
                <Text variant="caption" color="textTertiary">
                  Joining counts as an on-site visit for a limited time. Only people who turn on Open to Talk appear in people cards.
                </Text>
              )}
            </Card>
          ) : null}
          {p.kind === 'long_term' && p.member_field_label && !p.my_status ? (
            <TextField
              label={`${p.member_field_label} (optional)`}
              placeholder={p.member_field_hint ?? undefined}
              value={memberNote}
              onChangeText={setMemberNote}
              maxCount={100}
              hint="Shown to members of this Server next to your name. You can change it later."
            />
          ) : null}

          {joinCode === 'parent_membership_required' ? (
            <Banner
              tone="warning"
              title={`Join ${p.parent_name ?? 'the parent Server'} first`}
              body="This Server is only open to members of its parent. Join the parent, then scan this code again."
            />
          ) : null}
          {joinCode === 'banned' ? <Banner tone="danger" title="You can't join this Server" body="You were removed from it by its admins." /> : null}
          {joinCode === 'rate_limited' ? <Banner tone="warning" body={toAppError(join.error).message} /> : null}
          {joinResult?.status === 'invalid' ? <Banner tone="danger" title="Invite not valid" body="This code is invalid or has expired." /> : null}

          {joinResult?.status === 'pending' || p.my_status === 'pending' ? (
            <Banner
              tone="success"
              icon="time-outline"
              title="Request sent"
              body={`You're awaiting approval from the admins of ${p.name}. We'll notify you when they decide.`}
            />
          ) : null}

          {p.my_status === 'active' ? (
            <>
              <Banner tone="success" icon="checkmark-circle-outline" body={`You're already a member of ${p.name}.`} />
              <Button
                title={p.kind === 'short_term' ? (openToTalk ? 'Continue as Open to Talk' : 'Continue') : 'Open Server'}
                icon="arrow-forward"
                loading={setVenue.isPending}
                disabled={!!rescanId && mySession.isLoading}
                onPress={() => continueActive(p)}
              />
            </>
          ) : p.my_status === 'banned' ? null : joinResult?.status === 'pending' || p.my_status === 'pending' ? (
            <Button title="Done" variant="secondary" onPress={() => router.back()} />
          ) : (
            <Button
              title={p.join_policy === 'approval' ? 'Request to join' : 'Join'}
              icon="enter-outline"
              loading={join.isPending}
              disabled={joinCode === 'banned'}
              onPress={() => doJoin(p)}
            />
          )}
          <Button title="Not this one" variant="ghost" onPress={reset} />
        </View>
      );
    }
  }

  // ------------------------------------------------------------------ input (scan / manual)
  const scanner = (() => {
    if (!permission) return <Card style={{ height: 280 }} />;
    if (!permission.granted) {
      const blocked = !permission.canAskAgain;
      return (
        <Card tone="brand" style={{ gap: 12, alignItems: 'flex-start' }}>
          <Ionicons name="camera-outline" size={28} color={colors.primary} />
          <Text variant="heading">{blocked ? 'Camera access is off' : 'Scan with your camera'}</Text>
          <Text variant="callout" color="textSecondary">
            {blocked
              ? 'Enable camera access for Sniff.in in your device Settings to scan QR codes. You can also paste an invite link or type a code instead.'
              : 'Sniff.in uses the camera only to read a Server QR code on this screen. Nothing is recorded or saved.'}
          </Text>
          {blocked ? (
            <Button title="Open Settings" icon="settings-outline" onPress={() => Linking.openSettings()} />
          ) : (
            <Button title="Allow camera" icon="camera" onPress={() => requestPermission()} />
          )}
          <Button title="Enter a code instead" variant="ghost" onPress={() => setMode('manual')} />
        </Card>
      );
    }
    return (
      <View style={{ gap: 12 }}>
        <View style={{ height: 320, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={inputError || showPreview ? undefined : onScanned}
            accessibilityLabel="Camera viewfinder for scanning a Server QR code"
          />
          <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 200, height: 200, borderRadius: 24, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' }} />
          </View>
        </View>
        <Text variant="caption" color="textSecondary" align="center">
          Point your camera at a Sniff.in QR code.
        </Text>
      </View>
    );
  })();

  const manualEntry = (
    <View style={{ gap: 12 }}>
      <TextField
        label="Invite link or code"
        placeholder="Invite link, or code like ABCD 2345"
        hint="Paste an invite link or enter an 8-character code"
        value={manual}
        onChangeText={(v) => {
          setManual(v);
          setInputError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={submitManual}
        error={mode === 'manual' ? inputError ?? undefined : undefined}
        right={<Button title="Paste" size="sm" variant="ghost" onPress={pasteFromClipboard} />}
      />
      <Button title="Continue" disabled={!manual.trim()} onPress={submitManual} />
    </View>
  );

  return (
    <Screen header={<AppHeader title="Join a Server" subtitle="Scan a QR code or enter an invite" />}>
      {showPreview ? (
        body
      ) : (
        <>
          <SegmentedControl<Mode>
            options={[{ value: 'scan', label: 'Scan QR' }, { value: 'manual', label: 'Enter code' }]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setInputError(null);
              scanLock.current = false;
            }}
          />
          {mode === 'scan' && inputError ? (
            <View style={{ gap: 12 }}>
              <Banner tone="danger" body={inputError} />
              <Button
                title="Scan again"
                icon="scan-outline"
                onPress={() => {
                  scanLock.current = false;
                  setInputError(null);
                }}
              />
            </View>
          ) : null}
          {mode === 'scan' ? scanner : manualEntry}
          <Text variant="caption" color="textTertiary" align="center">
            QR codes and codes are checked by Sniff.in. Expired or revoked invites won&apos;t work.
          </Text>
        </>
      )}
    </Screen>
  );
}
