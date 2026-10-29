import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import { ActionMenu } from '@/components/ActionMenu';
import { ServerAvatar } from '@/components/ServerAvatar';
import { ServerMemberSettings } from '@/components/ServerMemberSettings';

import {
  AppHeader, Banner, Button, ErrorState, ListGroup, LoadingList, RadioGroup, Screen, SectionHeader, SwitchRow, Tag, TagList,
  Text, TextField, confirm, toast,
} from '@/components/ui';
import { useRemoveServerAvatar, useServer, useUpdateServer, useUploadServerAvatar } from '@/features/servers/hooks';
import { END_PRESETS, endNowDate, formatDateTime } from '@/features/servers/presets';
import type { ServerSettingsPatch } from '@/features/servers/api';
import type { JoinPolicy, ServerDetail, ServerVisibility } from '@/types/domain';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/theme';

function parseCoord(text: string, min: number, max: number): number | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < min || n > max) return 'invalid';
  return n;
}

/** Admin-only Server picture: pick (library or camera, square crop), upload with progress, or remove. */
function ServerPictureSection({ s }: { s: ServerDetail }) {
  const { colors, radius } = useTheme();
  const upload = useUploadServerAvatar(s.id);
  const remove = useRemoveServerAvatar(s.id);
  const [menu, setMenu] = useState(false);
  const [progress, setProgress] = useState(0);
  const busy = upload.isPending || remove.isPending;

  const send = async (res: ImagePicker.ImagePickerResult) => {
    const uri = res.canceled ? null : res.assets[0]?.uri;
    if (!uri) return;
    setProgress(0);
    try {
      await upload.mutateAsync({ uri, previous: s.avatar_path, onProgress: setProgress });
      toast.success('Server picture updated');
    } catch (e) {
      toast.error(e);
    }
  };

  const fromLibrary = async () => {
    try {
      // The system photo picker needs no storage permission and only shares the photo you choose.
      await send(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 }));
    } catch (e) {
      toast.error(e);
    }
  };

  const fromCamera = async () => {
    try {
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) {
        const go = await new Promise<boolean>((resolve) =>
          Alert.alert('Use the camera?', "Sniff.in uses the camera only to take this Server's picture. Nothing is recorded or shared until you save it.", [
            { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue', onPress: () => resolve(true) },
          ], { cancelable: true, onDismiss: () => resolve(false) }),
        );
        if (!go) return;
        perm = await ImagePicker.requestCameraPermissionsAsync();
      }
      if (!perm.granted) {
        Alert.alert('Camera access is off', 'Enable camera access for Sniff.in in your device Settings to take a picture, or choose one from your library instead.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      await send(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 }));
    } catch (e) {
      toast.error(e);
    }
  };

  const onRemove = async () => {
    if (!s.avatar_path) return;
    const ok = await confirm({ title: 'Remove the Server picture?', message: 'Members will see the default icon instead.', confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    remove.mutate(s.avatar_path, { onSuccess: () => toast.success('Picture removed'), onError: toast.error });
  };

  return (
    <View style={{ gap: 12 }}>
      <SectionHeader title="Server picture" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <ServerAvatar name={s.name} category={s.category} avatarPath={s.avatar_path} size={88} />
        <View style={{ flex: 1, gap: 8 }}>
          <Button title={s.avatar_path ? 'Change picture' : 'Add a picture'} size="sm" icon="image-outline" disabled={busy} onPress={() => setMenu(true)} />
          {s.avatar_path ? (
            <Button title="Remove picture" size="sm" variant="danger" icon="trash-outline" loading={remove.isPending} disabled={upload.isPending} onPress={onRemove} />
          ) : null}
        </View>
      </View>
      {upload.isPending ? (
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={{ gap: 6 }}>
          <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(4, Math.round(progress * 100))}%`, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary }} />
          </View>
          <Text variant="caption" color="textSecondary">
            Uploading… {Math.round(progress * 100)}%
          </Text>
        </View>
      ) : (
        <Text variant="caption" color="textTertiary">
          Pick a square picture; you can move and crop it after choosing. It shows on cards, Discover and the Server page.
        </Text>
      )}
      <ActionMenu
        visible={menu}
        title="Server picture"
        onClose={() => setMenu(false)}
        actions={[
          { label: 'Choose from library', icon: 'images-outline', onPress: fromLibrary },
          { label: 'Take a photo', icon: 'camera-outline', onPress: fromCamera },
        ]}
      />
    </View>
  );
}

function SettingsForm({ s }: { s: ServerDetail }) {
  const now = useNow();
  const update = useUpdateServer(s.id);
  const short = s.kind === 'short_term';

  const [name, setName] = useState(s.name);
  const [description, setDescription] = useState(s.description ?? '');
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>(s.join_policy);
  const [visibility, setVisibility] = useState<ServerVisibility>(s.visibility);
  const [endsAt, setEndsAt] = useState<Date | null>(s.ends_at ? new Date(s.ends_at) : null);
  const [endsChanged, setEndsChanged] = useState(false);
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [ephemeral, setEphemeral] = useState(s.ephemeral_chats);
  const [city, setCity] = useState(s.city ?? '');
  const [lat, setLat] = useState(s.venue_lat != null ? String(s.venue_lat) : '');
  const [lng, setLng] = useState(s.venue_lng != null ? String(s.venue_lng) : '');
  const [requiresParent, setRequiresParent] = useState(s.requires_parent_membership);
  const [memberFieldLabel, setMemberFieldLabel] = useState(s.member_field_label ?? '');
  const [memberFieldHint, setMemberFieldHint] = useState(s.member_field_hint ?? '');

  const latV = parseCoord(lat, -90, 90);
  const lngV = parseCoord(lng, -180, 180);
  const coordError =
    latV === 'invalid' ? 'Latitude must be between -90 and 90' : lngV === 'invalid' ? 'Longitude must be between -180 and 180'
      : (latV === null) !== (lngV === null) ? 'Enter both latitude and longitude, or leave both empty' : null;
  const nameError = name.trim().length < 2 ? 'At least 2 characters' : null;
  const endsError = short && endsChanged && endsAt && endsAt.getTime() <= now ? 'End time must be in the future' : null;
  const invalid = !!(coordError || nameError || endsError);

  const pickPreset = (key: string) => {
    const p = END_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setPresetKey(key);
    setEndsAt(p.at());
    setEndsChanged(true);
  };

  const save = () => {
    if (invalid) return;
    const patch: ServerSettingsPatch = {};
    if (name.trim() !== s.name) patch.name = name.trim();
    if ((description.trim() || null) !== s.description) patch.description = description.trim() || null;
    if (joinPolicy !== s.join_policy) patch.join_policy = joinPolicy;
    if (visibility !== s.visibility) patch.visibility = visibility;
    if (short && endsChanged && endsAt) {
      patch.ends_at = (presetKey ? END_PRESETS.find((p) => p.key === presetKey)?.at() ?? endsAt : endsAt).toISOString();
    }
    if (short && ephemeral !== s.ephemeral_chats) patch.ephemeral_chats = ephemeral;
    if ((city.trim() || null) !== s.city) patch.city = city.trim() || null;
    const la = latV === 'invalid' ? null : latV;
    const lo = lngV === 'invalid' ? null : lngV;
    if (la !== s.venue_lat) patch.venue_lat = la;
    if (lo !== s.venue_lng) patch.venue_lng = lo;
    if (s.parent && requiresParent !== s.requires_parent_membership) patch.requires_parent_membership = requiresParent;
    if (s.kind === 'long_term' && (memberFieldLabel.trim() || null) !== s.member_field_label) patch.member_field_label = memberFieldLabel.trim() || null;
    if (s.kind === 'long_term' && (memberFieldHint.trim() || null) !== s.member_field_hint) patch.member_field_hint = memberFieldHint.trim() || null;

    if (Object.keys(patch).length === 0) {
      toast.info('No changes to save');
      return;
    }
    update.mutate(patch, {
      onSuccess: () => {
        toast.success('Settings saved');
        router.back();
      },
      onError: toast.error,
    });
  };

  const endNow = async () => {
    const ok = await confirm({
      title: 'End this Server now?',
      message: s.ephemeral_chats
        ? 'Joining and discovery close in about a minute. Chats started here will expire unless both people saved the connection.'
        : 'Joining and discovery close in about a minute.',
      confirmLabel: 'End now',
      destructive: true,
    });
    if (!ok) return;
    update.mutate(
      { ends_at: endNowDate().toISOString() },
      {
        onSuccess: () => {
          toast.success('The event will end in a minute');
          router.back();
        },
        onError: toast.error,
      },
    );
  };

  const policyOptions: { value: JoinPolicy; label: string; description?: string }[] = [
    { value: 'invite_only', label: 'Invite only (QR/code)', description: 'People join only with a QR code, link or code you share.' },
    { value: 'approval', label: 'Anyone with the QR can request, admins approve', description: 'You review every join request.' },
    ...(s.kind === 'global' ? [{ value: 'open' as const, label: 'Open', description: 'Anyone can join.' }] : []),
  ];

  return (
    <Screen
      header={<AppHeader title="Server settings" subtitle={s.name} />}
      edges={['top', 'bottom']}
      footer={<Button title="Save changes" icon="checkmark" loading={update.isPending} disabled={invalid} onPress={save} />}>
      <ServerPictureSection s={s} />
      <TextField label="Name" value={name} onChangeText={setName} maxCount={80} error={nameError ?? undefined} />
      <TextField label="Description" value={description} onChangeText={setDescription} maxCount={500} multiline />

      {s.kind === 'long_term' ? <View style={{ gap: 10 }}>
        <SectionHeader title="Member information" />
        <Text variant="caption" color="textSecondary">Ask members for one short, optional detail such as a flat, hall or room number. Only members can see it.</Text>
        <TextField label="Field label" value={memberFieldLabel} onChangeText={setMemberFieldLabel} maxCount={40} placeholder="Flat or room" />
        <TextField label="Instructions" value={memberFieldHint} onChangeText={setMemberFieldHint} maxCount={120} placeholder="For example, Hall 4 · Room 18" />
      </View> : null}

      <View style={{ gap: 8 }}>
        <SectionHeader title="Who can join" />
        <RadioGroup<JoinPolicy> options={policyOptions} value={joinPolicy} onChange={setJoinPolicy} />
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Visibility" />
        <RadioGroup<ServerVisibility>
          options={[
            { value: 'listed', label: 'Discoverable in search', description: 'Anyone can find this Server in Explore.' },
            { value: 'unlisted', label: 'Unlisted', description: 'Only people with a QR code, link or invite can find it.' },
          ]}
          value={visibility}
          onChange={setVisibility}
        />
      </View>

      {short ? (
        <View style={{ gap: 12 }}>
          <SectionHeader title="Schedule" />
          <Text variant="callout" color="textSecondary">
            {s.ends_at ? `${s.is_live ? 'Currently ends' : 'Ended'} ${formatDateTime(s.ends_at)}.` : 'No end time set.'} Change it from now:
          </Text>
          <TagList>
            {END_PRESETS.map((p) => (
              <Tag key={p.key} label={p.label} selected={presetKey === p.key} onPress={() => pickPreset(p.key)} />
            ))}
          </TagList>
          {endsChanged && endsAt ? (
            <Text variant="callout" color="textSecondary">
              New end time: {formatDateTime(endsAt)}
            </Text>
          ) : null}
          {endsError ? <Text variant="caption" color="danger">{endsError}</Text> : null}
          <ListGroup>
            <SwitchRow
              icon="chatbubbles-outline"
              title="Chats disappear when the event ends"
              subtitle="Conversations expire at the end unless both people tap Save connection."
              value={ephemeral}
              onValueChange={setEphemeral}
            />
          </ListGroup>
          {s.is_live ? <Button title="End now" variant="danger" icon="stop-circle-outline" loading={update.isPending} onPress={endNow} /> : null}
        </View>
      ) : null}

      {s.parent ? (
        <ListGroup>
          <SwitchRow
            icon="git-branch-outline"
            title="Require parent membership"
            subtitle={`Only active members of ${s.parent.name} can join.`}
            value={requiresParent}
            onValueChange={setRequiresParent}
          />
        </ListGroup>
      ) : null}

      <TextField label="City (optional)" value={city} onChangeText={setCity} maxCount={60} autoCapitalize="words" />

      <View style={{ gap: 8 }}>
        <SectionHeader title="Venue location (optional)" />
        <Banner
          tone="info"
          icon="location-outline"
          body="Optional venue location for this Server's page. This is the venue's location, never a member's."
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <TextField label="Latitude" value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" placeholder="12.9716" autoCorrect={false} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label="Longitude" value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" placeholder="77.5946" autoCorrect={false} />
          </View>
        </View>
        {coordError ? <Text variant="caption" color="danger">{coordError}</Text> : null}
      </View>
    </Screen>
  );
}

export default function SettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const server = useServer(id);

  if (server.isLoading) {
    return (
      <Screen header={<AppHeader title="Server settings" />}>
        <LoadingList count={3} />
      </Screen>
    );
  }
  if (server.isError || !server.data) {
    return (
      <Screen header={<AppHeader title="Server settings" />}>
        <ErrorState error={server.error} onRetry={server.refetch} />
      </Screen>
    );
  }
  if (!server.data.is_admin) {
    return <ServerMemberSettings server={server.data} />;
  }
  // key forces a fresh form if the Server identity changes; edits are local until saved.
  return <SettingsForm key={server.data.id} s={server.data} />;
}
