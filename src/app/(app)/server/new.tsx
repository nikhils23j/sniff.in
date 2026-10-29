import { zodResolver } from '@hookform/resolvers/zod';
import { addDays, addHours } from 'date-fns';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import type { z } from 'zod';

import {
  AppHeader, Banner, Button, FormField, ListGroup, RadioGroup, Screen, SectionHeader, SegmentedControl, SwitchRow, Tag, TagList, Text,
  TextField, toast,
} from '@/components/ui';
import { useIsPlatformAdmin } from '@/features/profile/hooks';
import { useCreateServer, useServer } from '@/features/servers/hooks';
import { CATEGORY_LABEL, CREATE_END_PRESET_KEYS, END_PRESETS, categoriesFor, formatDateTime } from '@/features/servers/presets';
import { serverSchema } from '@/lib/validation';
import type { JoinPolicy, ServerCategory, ServerKind } from '@/types/domain';

type FormIn = z.input<typeof serverSchema>;
type FormOut = z.output<typeof serverSchema>;
type CustomUnit = 'h' | 'd';
type ServerChoice = ServerKind | 'scheduled';

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const CREATE_PRESETS = END_PRESETS.filter((p) => (CREATE_END_PRESET_KEYS as readonly string[]).includes(p.key));

/** Custom event length: whole hours (1–720) or days (1–30); null when the input isn't usable. */
function customEnd(value: string, unit: CustomUnit): Date | null {
  const n = Number(value.trim());
  if (!value.trim() || !Number.isInteger(n) || n < 1) return null;
  if (unit === 'h' ? n > 720 : n > 30) return null;
  return unit === 'h' ? addHours(new Date(), n) : addDays(new Date(), n);
}

function scheduledTimes(date: string, time: string, hours: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const duration = Number(hours);
  const start = new Date(`${date}T${time}:00`);
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isInteger(duration) || duration < 1 || duration > 720 || Number.isNaN(start.getTime())
    || start.getFullYear() !== year || start.getMonth() + 1 !== month || start.getDate() !== day
    || start.getHours() !== hour || start.getMinutes() !== minute
    || start.getTime() <= Date.now() || start.getTime() > Date.now() + 30 * 86400_000) return null;
  return { start, end: addHours(start, duration) };
}

export default function NewServerScreen() {
  const { parentId } = useLocalSearchParams<{ parentId?: string }>();
  const parent = useServer(parentId);
  const isPlatformAdmin = useIsPlatformAdmin().data === true;
  const create = useCreateServer();
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [requiresParent, setRequiresParent] = useState(false);
  const [customValue, setCustomValue] = useState('6');
  const [customUnit, setCustomUnit] = useState<CustomUnit>('h');
  const [scheduled, setScheduled] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [durationHours, setDurationHours] = useState('4');
  const [venue, setVenue] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const { control, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(serverSchema),
    defaultValues: {
      name: '', description: '', kind: 'long_term', category: 'community', joinPolicy: 'invite_only', visibility: 'unlisted',
      endsAt: null, ephemeralChats: false, city: '',
    },
  });
  const kind = watch('kind') as ServerKind;
  const category = watch('category') as ServerCategory;
  const endsAt = watch('endsAt');
  const short = kind === 'short_term';

  const changeKind = (choice: ServerChoice) => {
    const k: ServerKind = choice === 'scheduled' ? 'short_term' : choice;
    setScheduled(choice === 'scheduled');
    setValue('kind', k);
    const cats = categoriesFor(k);
    if (!cats.includes(category)) setValue('category', cats[0]);
    if (k !== 'short_term') {
      setValue('endsAt', null);
      setValue('ephemeralChats', false);
      setPresetKey(null);
      setVenue(null);
    } else {
      // Temporary default: ephemeral chats on (privacy-friendly) and listed, so the venue can show on the Hot Map.
      setValue('ephemeralChats', true);
      setValue('visibility', 'listed');
      if (choice === 'scheduled') setValue('endsAt', scheduledTimes(startDate, startTime, durationHours)?.end ?? null);
      else if (!presetKey) pickPreset('4h');
    }
    if (k !== 'global' && watch('joinPolicy') === 'open') setValue('joinPolicy', 'invite_only');
  };

  const changeSchedule = (date: string, time: string, hours: string) => {
    setStartDate(date); setStartTime(time); setDurationHours(hours);
    setValue('endsAt', scheduledTimes(date, time, hours)?.end ?? null, { shouldValidate: true });
  };

  function pickPreset(key: string) {
    if (key === 'custom') {
      setPresetKey('custom');
      setValue('endsAt', customEnd(customValue, customUnit), { shouldValidate: true });
      return;
    }
    const p = END_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setPresetKey(key);
    setValue('endsAt', p.at(), { shouldValidate: true });
  }

  const changeCustom = (value: string, unit: CustomUnit) => {
    setCustomValue(value);
    setCustomUnit(unit);
    setValue('endsAt', customEnd(value, unit), { shouldValidate: true });
  };

  const pickMyLocation = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        toast.info('Location access is off. You can still create the Server without a venue location.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setVenue({ lat: round4(pos.coords.latitude), lng: round4(pos.coords.longitude) });
    } catch (e) {
      toast.error(e);
    } finally {
      setLocating(false);
    }
  };

  const kindOptions: { value: ServerChoice; label: string; description: string }[] = [
    { value: 'long_term', label: 'Permanent', description: 'A campus, hostel, club, company, apartment or alumni group. Members stay until they leave.' },
    { value: 'short_term', label: 'Temporary', description: 'A concert, conference, party or meetup that ends automatically. People join by scanning its QR code.' },
    { value: 'scheduled', label: 'Scheduled temporary', description: 'Plan an upcoming event. People can join and see who is attending before it starts.' },
    ...(isPlatformAdmin ? [{ value: 'global' as const, label: 'City-wide (platform admins)', description: 'Curated, permanent, feature-flagged beta.' }] : []),
  ];

  const policyOptions: { value: JoinPolicy; label: string; description?: string }[] = [
    { value: 'invite_only', label: 'Invite only (QR/code)', description: 'People join only with a QR code, link or code you share.' },
    { value: 'approval', label: 'Anyone with the QR can request, admins approve', description: 'You review every join request before they get in.' },
    ...(kind === 'global' ? [{ value: 'open' as const, label: 'Open', description: 'Anyone can join.' }] : []),
  ];

  const onSubmit = handleSubmit(async (v) => {
    try {
      // Presets are "from now", so recompute at submit time.
      const schedule = scheduled ? scheduledTimes(startDate, startTime, durationHours) : null;
      if (scheduled && !schedule) return toast.error('Enter a future start date, time and duration of 1–720 hours.');
      const ends = !short ? null : scheduled ? schedule!.end
        : presetKey === 'custom' ? customEnd(customValue, customUnit)
          : END_PRESETS.find((p) => p.key === presetKey)?.at() ?? v.endsAt;
      if (short && !ends) {
        toast.error('Choose when the event ends');
        return;
      }
      const id = await create.mutateAsync({
        name: v.name.trim(),
        kind: v.kind,
        category: v.category as ServerCategory,
        description: v.description?.trim() || null,
        parentId: parentId || null,
        joinPolicy: v.joinPolicy,
        visibility: v.visibility,
        startsAt: schedule?.start.toISOString() ?? null,
        endsAt: ends ? ends.toISOString() : null,
        ephemeralChats: short ? v.ephemeralChats : false,
        city: v.city?.trim() || null,
        venueLat: short && venue ? venue.lat : null,
        venueLng: short && venue ? venue.lng : null,
        requiresParentMembership: !!parentId && requiresParent,
      });
      toast.success('Server created. Share its QR code to invite people.');
      router.replace(`/server/${id}/invites`);
    } catch (e) {
      toast.error(e);
    }
  });

  return (
    <Screen
      header={<AppHeader title={parentId ? 'Create a sub-Server' : 'Create a Server'} />}
      edges={['top', 'bottom']}
      footer={<Button title="Create Server" icon="checkmark" loading={create.isPending} onPress={() => onSubmit()} />}>
      {parentId ? (
        <View style={{ gap: 12 }}>
          <Banner tone="info" icon="git-branch-outline" title={`Inside ${parent.data?.name ?? 'parent Server'}`} body="Members of the parent don't join automatically. Admins of the parent can manage this Server." />
          <ListGroup>
            <SwitchRow
              title="Require parent membership"
              subtitle="Only active members of the parent Server can join this one."
              value={requiresParent}
              onValueChange={setRequiresParent}
            />
          </ListGroup>
        </View>
      ) : null}

      <FormField control={control} name="name" label="Name" placeholder={short ? 'Friday night at Kitty Su' : 'IIT Kanpur, Hall 4'} maxCount={80} autoCapitalize="words" />
      <FormField control={control} name="description" label="Description (optional)" placeholder="What is this Server about?" multiline maxCount={500} />

      <View style={{ gap: 8 }}>
        <SectionHeader title="Type" />
        <RadioGroup<ServerChoice> options={kindOptions} value={scheduled ? 'scheduled' : kind} onChange={changeKind} />
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Category" />
        <TagList>
          {categoriesFor(kind).map((c) => (
            <Tag key={c} label={CATEGORY_LABEL[c]} selected={c === category} onPress={() => setValue('category', c)} />
          ))}
        </TagList>
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Who can join" />
        <Controller
          control={control}
          name="joinPolicy"
          render={({ field }) => <RadioGroup<JoinPolicy> options={policyOptions} value={field.value} onChange={field.onChange} />}
        />
        {errors.joinPolicy ? <Text variant="caption" color="danger">{errors.joinPolicy.message}</Text> : null}
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Visibility" />
        <Controller
          control={control}
          name="visibility"
          render={({ field }) => (
            <RadioGroup
              options={[
                {
                  value: 'listed', label: 'Public (listed)',
                  description: short
                    ? 'Anyone can find it in search, and the venue can appear on the Hot Map and Home.'
                    : 'Anyone can find it in search and ask to join (if you allow requests).',
                },
                { value: 'unlisted', label: 'Invite-only', description: 'Hidden from search. Only people with your QR code, link or invite code can find it.' },
              ]}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </View>

      {short ? (
        <View style={{ gap: 12 }}>
          <SectionHeader title={scheduled ? 'Schedule' : 'Ends'} />
          {scheduled ? <View style={{ gap: 10 }}>
            <TextField label="Start date (YYYY-MM-DD)" value={startDate} onChangeText={(value) => changeSchedule(value, startTime, durationHours)} placeholder="2026-11-15" keyboardType="numbers-and-punctuation" />
            <TextField label="Start time (24-hour HH:mm)" value={startTime} onChangeText={(value) => changeSchedule(startDate, value, durationHours)} placeholder="18:30" keyboardType="numbers-and-punctuation" />
            <TextField label="Duration in hours" value={durationHours} onChangeText={(value) => changeSchedule(startDate, startTime, value.replace(/[^0-9]/g, ''))} keyboardType="number-pad" />
            <Text variant="caption" color="textSecondary">Members can join early and see the attendee list. The live event begins at the start time.</Text>
          </View> : null}
          {!scheduled ? <>
          <TagList>
            {CREATE_PRESETS.map((p) => (
              <Tag key={p.key} label={p.key === 'tonight' ? 'Tonight' : p.label} selected={presetKey === p.key} onPress={() => pickPreset(p.key)} />
            ))}
            <Tag label="Custom" icon="time-outline" selected={presetKey === 'custom'} onPress={() => pickPreset('custom')} />
          </TagList>
          {presetKey === 'custom' ? (
            <View style={{ gap: 8 }}>
              <SegmentedControl<CustomUnit>
                options={[{ value: 'h', label: 'Hours' }, { value: 'd', label: 'Days' }]}
                value={customUnit}
                onChange={(u) => changeCustom(customValue, u)}
              />
              <TextField
                label={customUnit === 'h' ? 'Lasts for (hours, up to 720)' : 'Lasts for (days, up to 30)'}
                value={customValue}
                onChangeText={(t) => changeCustom(t.replace(/[^0-9]/g, ''), customUnit)}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
          ) : null}
          </> : null}
          {endsAt ? (
            <Text variant="callout" color="textSecondary">
              Ends {formatDateTime(endsAt)}. After that, joining and discovery close automatically.
            </Text>
          ) : null}
          {errors.endsAt ? <Text variant="caption" color="danger">{errors.endsAt.message}</Text> : null}
          <View style={{ gap: 8 }}>
            <Text variant="subheading">Venue location (optional)</Text>
            <Text variant="caption" color="textSecondary">
              Puts the venue on the Hot Map and on Home for people nearby once 3 or more people are there. Only this venue point is
              stored (rounded to about 10 m), never anyone&apos;s live location. Needs Public visibility.
            </Text>
            {venue ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag label={`Venue set · ${venue.lat.toFixed(4)}, ${venue.lng.toFixed(4)}`} tone="accent" icon="location" />
                <Button title="Remove" size="sm" variant="ghost" onPress={() => setVenue(null)} />
              </View>
            ) : (
              <Button title="Use my current location as the venue" size="sm" variant="secondary" icon="location-outline"
                loading={locating} onPress={() => void pickMyLocation()} />
            )}
          </View>
          <Controller
            control={control}
            name="ephemeralChats"
            render={({ field }) => (
              <ListGroup>
                <SwitchRow
                  icon="chatbubbles-outline"
                  title="Chats disappear when the event ends"
                  subtitle="Conversations started here are deleted at the end unless both people tap Save connection."
                  value={!!field.value}
                  onValueChange={field.onChange}
                />
              </ListGroup>
            )}
          />
        </View>
      ) : null}

      <FormField control={control} name="city" label="City (optional)" placeholder="Bengaluru" maxCount={60} autoCapitalize="words" />
    </Screen>
  );
}
