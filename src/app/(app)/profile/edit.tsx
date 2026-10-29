import { zodResolver } from '@hookform/resolvers/zod';
import * as ImagePicker from 'expo-image-picker';
import { router, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Alert, Linking, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { z } from 'zod';

import { ActionMenu } from '@/components/ActionMenu';
import { AffiliationBadge } from '@/components/AffiliationBadge';
import { ProfilePreview } from '@/components/ProfilePreview';

import {
  AppHeader, Avatar, Banner, Button, ErrorState, FormField, ListGroup, ListRow, LoadingList, RadioGroup, Screen, Tag, Text, TextField, confirm, toast,
} from '@/components/ui';
import { profileApi, type ProfilePatch } from '@/features/profile/api';
import { refreshProfileEmbedding } from '@/features/profile/embedding';
import { connectSpotify, disconnectSpotify } from '@/features/profile/spotify';
import {
  useMe, useMySettings, useProfile, useRemoveAffiliation, useRemoveAvatar, useSetUsername, useUpdateMe, useUploadAvatar,
} from '@/features/profile/hooks';
import { toAppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { secureSessionStorage } from '@/lib/secure-storage';
import { profileSchema, usernameSchema } from '@/lib/validation';
import { useTheme } from '@/theme';
import type { Affiliation, FieldVisibility, MyProfile, UserSettings } from '@/types/domain';

type FormIn = z.input<typeof profileSchema>;
type FormOut = z.output<typeof profileSchema>;

const LEVEL_LABEL: Record<FieldVisibility, string> = { members: 'Members', connections: 'Connections', only_me: 'Only me' };

const FORM_KEYS = [
  'display_name', 'bio', 'social_preferences', 'professional_bio', 'work_experience', 'professional_interests',
  'university', 'occupation', 'career_goals', 'website_url', 'instagram_handle', 'linkedin_url',
  'height_cm', 'education_level', 'school_name', 'workplace', 'job_title', 'hometown', 'relationship_status',
] as const;

function formDefaults(me: MyProfile): FormIn {
  return {
    display_name: me.display_name,
    bio: me.bio ?? '',
    social_preferences: me.social_preferences ?? '',
    professional_bio: me.professional_bio ?? '',
    work_experience: me.work_experience ?? '',
    professional_interests: me.professional_interests ?? '',
    university: me.university ?? '',
    occupation: me.occupation ?? '',
    career_goals: me.career_goals ?? '',
    website_url: me.website_url ?? '',
    instagram_handle: me.instagram_handle ?? '',
    linkedin_url: me.linkedin_url ?? '',
    height_cm: me.height_cm ? String(me.height_cm) : '',
    education_level: me.education_level ?? '',
    school_name: me.school_name ?? '',
    workplace: me.workplace ?? '',
    job_title: me.job_title ?? '',
    hometown: me.hometown ?? '',
    relationship_status: me.relationship_status ?? '',
  };
}

/** A stored draft merged over the saved values (unknown keys / non-strings dropped). null = nothing usable. */
function parseDraft(saved: string, defaults: FormIn): FormIn | null {
  const raw: unknown = JSON.parse(saved);
  if (!raw || typeof raw !== 'object') return null;
  const draft: FormIn = { ...defaults };
  for (const key of FORM_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'string') draft[key] = v;
  }
  return draft;
}

const sameForm = (a: FormIn, b: FormIn) => FORM_KEYS.every((k) => (a[k] ?? '') === (b[k] ?? ''));

function VisibilityChip({ level }: { level: FieldVisibility | undefined }) {
  if (!level) return null;
  return (
    <View style={{ alignSelf: 'flex-start' }}>
      <Tag label={`Visible to: ${LEVEL_LABEL[level]}`} icon="eye-outline" small onPress={() => router.push('/settings/privacy')} />
    </View>
  );
}

export default function EditProfileScreen() {
  const me = useMe();
  const settings = useMySettings();

  if (me.isLoading) {
    return (
      <Screen header={<AppHeader title="Edit profile" />}>
        <LoadingList count={2} />
      </Screen>
    );
  }
  if (me.isError || !me.data) {
    return (
      <Screen header={<AppHeader title="Edit profile" />}>
        <ErrorState error={me.error ?? new Error('unknown')} onRetry={() => { me.refetch(); }} />
      </Screen>
    );
  }
  return <EditForm key={me.data.id} me={me.data} settings={settings.data} />;
}

function EditForm({ me, settings }: { me: MyProfile; settings: UserSettings | undefined }) {
  const update = useUpdateMe();
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const removeAff = useRemoveAffiliation();
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [allowLeave, setAllowLeave] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(Platform.OS === 'web');
  const pendingNavigation = useRef<(() => void) | null>(null);
  const draftKey = `sniffin.profile_draft.${me.id}`;
  const profile = useProfile(me.id);
  const affiliations: Affiliation[] = profile.data?.affiliations ?? [];

  const { control, handleSubmit, reset, getValues, formState: { isDirty } } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(profileSchema),
    defaultValues: formDefaults(me),
  });

  const values = useWatch({ control });

  // Restore an unsaved draft on top of the saved values. Keeping the saved values as the defaults keeps the form
  // dirty, so Save stays enabled and leaving still asks first.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let mounted = true;
    secureSessionStorage.getItem(draftKey).then((saved) => {
      if (!mounted) return;
      if (saved) {
        try {
          const defaults = getValues();
          const draft = parseDraft(saved, defaults);
          if (draft && !sameForm(draft, defaults)) {
            reset(draft, { keepDefaultValues: true });
            toast.info('Unsaved profile edits restored');
          } else {
            void secureSessionStorage.removeItem(draftKey).catch(() => {});
          }
        } catch {
          void secureSessionStorage.removeItem(draftKey).catch(() => {}); // a damaged local draft
        }
      }
      setDraftLoaded(true);
    }).catch(() => { if (mounted) setDraftLoaded(true); });
    return () => { mounted = false; };
  }, [draftKey, reset, getValues]);

  useEffect(() => {
    if (!draftLoaded || Platform.OS === 'web' || !isDirty) return;
    const id = setTimeout(() => {
      void secureSessionStorage.setItem(draftKey, JSON.stringify(values)).catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [draftKey, draftLoaded, isDirty, values]);

  const uploadPicked = async (res: ImagePicker.ImagePickerResult) => {
    if (res.canceled || !res.assets[0]) return;
    await upload.mutateAsync({ uri: res.assets[0].uri, previous: me.avatar_path });
    toast.success('Photo updated');
  };

  const pickPhoto = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
      await uploadPicked(res);
    } catch (e) {
      toast.error(e);
    }
  };

  const takePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        const open = await confirm({
          title: 'Camera access is off',
          message: 'Allow the camera in Settings to take a profile photo, or choose one from your library instead.',
          confirmLabel: 'Open Settings',
        });
        if (open) Linking.openSettings().catch(() => toast.info('Open Settings and allow the camera for Sniff.in.'));
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.9 });
      await uploadPicked(res);
    } catch (e) {
      toast.error(e);
    }
  };

  const removeVerified = async (a: Affiliation) => {
    const ok = await confirm({
      title: `Remove verified ${a.org_name}?`,
      message: 'Your badge disappears from your profile. You can verify again any time with a new code.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    removeAff.mutate(a.id, { onSuccess: () => toast.success('Verified badge removed'), onError: toast.error });
  };

  const goVerify = (kind: 'college' | 'employer') => router.push({ pathname: '/profile/verify', params: { kind } });

  const removePhoto = async () => {
    if (!me.avatar_path) return;
    const ok = await confirm({ title: 'Remove your photo?', message: 'People will see your initials instead.', confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    remove.mutate(me.avatar_path, { onSuccess: () => toast.success('Photo removed'), onError: toast.error });
  };

  /** `stay`: saved from the preview, so remain on Edit instead of going back. */
  const onSave = (opts: { stay?: boolean } = {}) => handleSubmit(async (v) => {
    const patch: ProfilePatch = {
      display_name: v.display_name,
      bio: v.bio ?? '',
      social_preferences: v.social_preferences ?? '',
      professional_bio: v.professional_bio ?? '',
      work_experience: v.work_experience ?? '',
      professional_interests: v.professional_interests ?? '',
      university: v.university ?? '',
      occupation: v.occupation ?? '',
      career_goals: v.career_goals ?? '',
      website_url: v.website_url ?? '',
      instagram_handle: v.instagram_handle ?? '',
      linkedin_url: v.linkedin_url ?? '',
      height_cm: v.height_cm ? Number(v.height_cm) : null,
      education_level: v.education_level || null,
      school_name: v.school_name ?? '',
      workplace: v.workplace ?? '',
      job_title: v.job_title ?? '',
      hometown: v.hometown ?? '',
      relationship_status: v.relationship_status || null,
    };
    try {
      await update.mutateAsync(patch);
      if (Platform.OS !== 'web') await secureSessionStorage.removeItem(draftKey).catch(() => {});
      // Semantic matching only ever runs with consent. Best effort, never blocks saving.
      if (settings?.ai_features_consent) void refreshProfileEmbedding();
      toast.success('Profile saved');
      setPreviewOpen(false);
      const resume = pendingNavigation.current;
      pendingNavigation.current = null;
      if (opts.stay && !resume) {
        // The saved values become the new baseline: the form is clean and keeps guarding later edits.
        const saved = Object.fromEntries(FORM_KEYS.map((k) => [k, (v[k] ?? '').trim()])) as FormIn;
        reset(saved);
        return;
      }
      setAllowLeave(true);
      setTimeout(() => {
        if (resume) resume();
        else if (router.canGoBack()) router.back();
        else router.replace('/me');
      }, 0);
    } catch (e) {
      toast.error(e);
    }
  }, () => {
    pendingNavigation.current = null;
    setPreviewOpen(false);
    toast.info('Fix the highlighted fields, then save again.');
  })();

  usePreventRemove(isDirty && !allowLeave, ({ repeat }) => {
    pendingNavigation.current = repeat;
    const discard = () => {
      pendingNavigation.current = null;
      setAllowLeave(true);
      if (Platform.OS !== 'web') void secureSessionStorage.removeItem(draftKey).catch(() => {});
      setTimeout(repeat, 0);
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Discard your unsaved profile edits?')) discard();
      else pendingNavigation.current = null;
      return;
    }
    Alert.alert('Unsaved profile edits', 'Save your changes or keep editing.', [
      { text: 'Keep editing', style: 'cancel', onPress: () => { pendingNavigation.current = null; } },
      { text: 'Discard', style: 'destructive', onPress: discard },
      { text: 'Save', onPress: () => { void onSave(); } },
    ]);
  });

  const busyPhoto = upload.isPending || remove.isPending;
  const onSpotifyConnect = async () => {
    setSpotifyBusy(true);
    try {
      if (await connectSpotify(me.id)) toast.success('Spotify connected to your profile');
    } catch (error) { toast.error(error); }
    finally { setSpotifyBusy(false); }
  };
  const onSpotifyDisconnect = async () => {
    if (!await confirm({ title: 'Disconnect Spotify?', message: 'Your Spotify profile link will disappear from Sniff.in.', confirmLabel: 'Disconnect', destructive: true })) return;
    setSpotifyBusy(true);
    try { await disconnectSpotify(); toast.success('Spotify disconnected'); }
    catch (error) { toast.error(error); }
    finally { setSpotifyBusy(false); }
  };

  if (!draftLoaded) return <Screen header={<AppHeader title="Edit profile" />}><LoadingList count={2} /></Screen>;

  return (
    <Screen
      header={
        <AppHeader
          title="Edit profile"
          right={<Button title="Preview" size="sm" variant="secondary" icon="eye-outline" onPress={() => setPreviewOpen(true)} />}
        />
      }
      edges={['top', 'bottom']}
      footer={<Button title="Save" size="lg" fullWidth loading={update.isPending} disabled={!isDirty} onPress={() => { onSave(); }} />}>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose a new photo" disabled={busyPhoto} onPress={() => setPhotoMenuOpen(true)} style={{ opacity: busyPhoto ? 0.5 : 1 }}>
          <Avatar path={me.avatar_path} name={me.display_name} size={104} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title={me.avatar_path ? 'Change photo' : 'Add photo'} size="sm" variant="secondary" icon="image-outline" loading={upload.isPending} disabled={busyPhoto} onPress={() => setPhotoMenuOpen(true)} />
          {me.avatar_path ? (
            <Button title="Remove" size="sm" variant="danger" icon="trash-outline" loading={remove.isPending} disabled={busyPhoto} onPress={removePhoto} />
          ) : null}
        </View>
        <Text variant="caption" color="textTertiary" align="center">
          Photos are private. Only people who can see your card get a short-lived link to it.
        </Text>
      </View>


      <ListGroup>
        <ListRow icon="at" title="Username" subtitle={`@${me.username}`} onPress={() => setUsernameOpen(true)} />
      </ListGroup>

      <Banner tone="info" icon="eye-outline" body="Everyone who can open your profile sees one profile. Each field shows who can see it; tap a chip to change it in Privacy & visibility. Your name and photo are always shown." />

      <FormField control={control} name="display_name" label="Name" maxCount={60} autoCapitalize="words" autoComplete="name" />

      <Text variant="heading" accessibilityRole="header">About</Text>
      <View style={{ gap: 8 }}>
        <FormField control={control} name="bio" label="Bio" multiline maxCount={300} placeholder="A line or two about you" />
        <VisibilityChip level={settings?.bio_visibility} />
      </View>
      <View style={{ gap: 8 }}>
        <FormField control={control} name="social_preferences" label="Conversation interests" multiline maxCount={300} placeholder="The conversations and activities you enjoy" />
        <VisibilityChip level={settings?.bio_visibility} />
      </View>
      <Button title="Photos & conversation starters" variant="secondary" icon="images-outline" onPress={() => router.push('/profile/personality')} />

      <Text variant="heading" accessibilityRole="header">Work & study</Text>
      <View style={{ gap: 8 }}>
        <FormField control={control} name="professional_bio" label="Professional bio" multiline maxCount={500} placeholder="What you do and what you care about" />
        <VisibilityChip level={settings?.bio_visibility} />
      </View>
      <View style={{ gap: 8 }}>
        <FormField control={control} name="university" label="College" maxCount={100} autoCapitalize="words" placeholder="IIT Kanpur" />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <VisibilityChip level={settings?.education_visibility} />
          <Button title="Verify" size="sm" variant="secondary" icon="shield-checkmark-outline" onPress={() => goVerify('college')} />
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <FormField control={control} name="occupation" label="Occupation or employer" maxCount={100} autoCapitalize="sentences" placeholder="Product designer at Acme" />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <VisibilityChip level={settings?.occupation_visibility} />
          <Button title="Verify" size="sm" variant="secondary" icon="shield-checkmark-outline" onPress={() => goVerify('employer')} />
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <FormField control={control} name="work_experience" label="Work experience" multiline maxCount={400} placeholder="Recent roles, projects or expertise" />
        <VisibilityChip level={settings?.occupation_visibility} />
      </View>
      <View style={{ gap: 8 }}>
        <FormField control={control} name="professional_interests" label="Professional interests" multiline maxCount={300} placeholder="Fields you want to explore" />
        <VisibilityChip level={settings?.career_goals_visibility} />
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="subheading">Verified by email</Text>
        {affiliations.length > 0 ? (
          affiliations.map((a) => (
            <AffiliationBadge key={a.id} affiliation={a} removing={removeAff.isPending && removeAff.variables === a.id} onRemove={() => { void removeVerified(a); }} />
          ))
        ) : (
          <Text variant="caption" color="textSecondary">
            What you type above is self-reported. Verify with a code sent to your college or work email to show a verified badge. We only keep the domain.
          </Text>
        )}
      </View>
      <View style={{ gap: 8 }}>
        <FormField control={control} name="career_goals" label="Career goals" multiline maxCount={300} placeholder="What you want to build or learn" />
        <VisibilityChip level={settings?.career_goals_visibility} />
      </View>

      <Text variant="heading" accessibilityRole="header">Personal details</Text>
      <FormField control={control} name="height_cm" label="Height in centimetres (optional)" keyboardType="number-pad" maxLength={3} />
      <Text variant="subheading">Education level</Text>
      <Controller control={control} name="education_level" render={({ field }) => <RadioGroup options={[
        { value: '', label: 'Prefer not to say' }, { value: 'school', label: 'School' }, { value: 'diploma', label: 'Diploma' },
        { value: 'undergraduate', label: 'Undergraduate' }, { value: 'postgraduate', label: 'Postgraduate' }, { value: 'doctorate', label: 'Doctorate' },
      ]} value={field.value ?? ''} onChange={field.onChange} />} />
      <FormField control={control} name="school_name" label="School or college" maxCount={120} />
      <FormField control={control} name="workplace" label="Workplace" maxCount={120} />
      <FormField control={control} name="job_title" label="Job title" maxCount={100} />
      <FormField control={control} name="hometown" label="Hometown" maxCount={100} />
      <Text variant="subheading">Relationship status (optional)</Text>
      <Controller control={control} name="relationship_status" render={({ field }) => <RadioGroup options={[
        { value: '', label: 'Prefer not to say' }, { value: 'single', label: 'Single' },
        { value: 'in_a_relationship', label: 'In a relationship' }, { value: 'married', label: 'Married' },
        { value: 'it_s_complicated', label: 'It’s complicated' },
      ]} value={field.value ?? ''} onChange={field.onChange} />} />

      <View style={{ gap: 4 }}>
        <Text variant="heading" accessibilityRole="header">
          Links
        </Text>
        <Text variant="caption" color="textSecondary">
          Website, Instagram and LinkedIn links are self-reported and visible to connections by default. Spotify is connected through your Spotify account.
        </Text>
      </View>
      <View style={{ gap: 14 }}>
        <FormField control={control} name="website_url" label="Website or portfolio" placeholder="https://" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <FormField control={control} name="instagram_handle" label="Instagram" placeholder="handle (no @)" autoCapitalize="none" autoCorrect={false} />
        <FormField control={control} name="linkedin_url" label="LinkedIn" placeholder="https://linkedin.com/in/…" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <View style={{ gap: 6 }}>
          <Text variant="callout">Spotify</Text>
          {me.spotify_url ? <Text variant="caption" color="textSecondary" numberOfLines={1}>{me.spotify_url}</Text> : null}
          <Button title={me.spotify_url ? 'Reconnect Spotify' : 'Connect with Spotify'} icon="musical-notes-outline"
            variant="secondary" loading={spotifyBusy} disabled={!env.spotifyClientId || Platform.OS !== 'android'} onPress={() => void onSpotifyConnect()} />
          {me.spotify_url ? <Button title="Disconnect Spotify" variant="ghost" size="sm" disabled={spotifyBusy}
            onPress={() => void onSpotifyDisconnect()} /> : null}
          {!env.spotifyClientId ? <Text variant="caption" color="textTertiary">Spotify connection opens after developer access is configured.</Text> : null}
          {Platform.OS !== 'android' ? <Text variant="caption" color="textTertiary">Spotify connection is available in the Android app.</Text> : null}
        </View>
        <VisibilityChip level={settings?.socials_visibility} />
      </View>

      <Text variant="caption" color="textTertiary">
        Interests, hobbies and skills are edited under Interests &amp; skills.
      </Text>

      <ActionMenu
        visible={photoMenuOpen}
        title="Profile photo"
        onClose={() => setPhotoMenuOpen(false)}
        actions={[
          { label: 'Choose from library', icon: 'image-outline', onPress: () => { void pickPhoto(); } },
          { label: 'Take a photo', icon: 'camera-outline', onPress: () => { void takePhoto(); } },
        ]}
      />

      <ProfilePreview
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onSave={() => { void onSave({ stay: true }); }}
        saving={update.isPending}
        canSave={isDirty}
        me={me}
        values={values}
      />

      <UsernameModal visible={usernameOpen} current={me.username} onClose={() => setUsernameOpen(false)} />
    </Screen>
  );
}

type Avail = 'idle' | 'checking' | 'available' | 'taken' | 'same' | 'error';

function UsernameModal({ visible, current, onClose }: { visible: boolean; current: string; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(current);
  const [avail, setAvail] = useState<Avail>('idle');
  const [formatError, setFormatError] = useState<string | undefined>();

  const save = useSetUsername();

  useEffect(() => {
    if (visible) {
      setValue(current);
      setAvail('idle');
      setFormatError(undefined);
    }
  }, [visible, current]);

  useEffect(() => {
    if (!visible) return;
    const parsed = usernameSchema.safeParse(value);
    if (!parsed.success) {
      setAvail('idle');
      setFormatError(value.trim() ? parsed.error.issues[0]?.message : undefined);
      return;
    }
    setFormatError(undefined);
    if (parsed.data === current) {
      setAvail('same');
      return;
    }
    setAvail('checking');
    let cancelled = false;
    const id = setTimeout(() => {
      profileApi.isUsernameAvailable(parsed.data).then(
        (ok) => !cancelled && setAvail(ok ? 'available' : 'taken'),
        () => !cancelled && setAvail('error'),
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [value, visible, current]);

  const hint =
    avail === 'checking' ? 'Checking…'
    : avail === 'available' ? 'Available'
    : avail === 'taken' ? 'That username is taken'
    : avail === 'same' ? 'This is your current username'
    : avail === 'error' ? "Couldn't check right now. You can still try to save."
    : '3 to 20 characters: letters, numbers and underscores';

  const submit = () => {
    const parsed = usernameSchema.safeParse(value);
    if (!parsed.success) {
      setFormatError(parsed.error.issues[0]?.message);
      return;
    }
    save.mutate(parsed.data, {
      onSuccess: () => {
        toast.success(`You are now @${parsed.data}`);
        onClose();
      },
      onError: (e) => {
        if (toAppError(e).code === 'username_taken') setAvail('taken');
        toast.error(e);
      },
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} />
      <View accessibilityViewIsModal style={{ backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: insets.bottom + 20, gap: 14 }}>
        <Text variant="title">Change username</Text>
        <Text variant="callout" color="textSecondary">
          Your old link stops working once you change it. Username changes are rate limited, so choose one you will keep.
        </Text>
        <TextField
          label="Username"
          value={value}
          onChangeText={setValue}
          autoCapitalize="none"
          autoCorrect={false}
          maxCount={20}
          error={formatError ?? (avail === 'taken' ? 'That username is taken' : undefined)}
          hint={hint}
        />
        <Button
          title="Save username"
          size="lg"
          loading={save.isPending}
          disabled={avail === 'taken' || avail === 'same' || avail === 'checking' || !!formatError || !value.trim()}
          onPress={submit}
        />
        <Button title="Cancel" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}
