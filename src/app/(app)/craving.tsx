import Ionicons from '@expo/vector-icons/Ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import type { z } from 'zod';

import {
  AppHeader, Banner, Button, Card, ErrorState, IconButton, LoadingList, RadioGroup, Screen, Tag, TagList, Text, TextField, confirm, toast,
} from '@/components/ui';
import { useClearCraving, useMyCraving, useMySettings, useSetCraving } from '@/features/profile/hooks';
import { useMyServers } from '@/features/servers/hooks';
import { cravingSchema } from '@/lib/validation';
import { useTheme } from '@/theme';
import type { Craving, FieldVisibility, ServerSummary } from '@/types/domain';

type FormValues = z.infer<typeof cravingSchema>;

const EXAMPLES = [
  'Looking for a badminton partner',
  'Want to talk about ML',
  'Need a UI/UX designer for a side project',
  'Up for coffee after this session',
  'Sharing a cab from the station?',
];

const DURATIONS: { value: number; label: string; description?: string }[] = [
  { value: 1, label: '1 hour' },
  { value: 3, label: '3 hours' },
  { value: 24, label: '24 hours', description: 'Default' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
];

const VIS_TEXT: Record<FieldVisibility, string> = {
  members: 'people who can currently see your card in that Server',
  connections: 'only people you have connected with',
  only_me: 'nobody. It is only used for your own matching',
};

const ALL = 'all';

export default function CravingScreen() {
  const craving = useMyCraving();
  const servers = useMyServers();
  const header = <AppHeader title="Current craving" back={false} right={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />;

  if (craving.isLoading || servers.isLoading) {
    return (
      <Screen header={header}>
        <LoadingList count={2} />
      </Screen>
    );
  }
  if (craving.isError || servers.isError) {
    return (
      <Screen header={header}>
        <ErrorState
          error={craving.error ?? servers.error ?? new Error('unknown')}
          onRetry={() => {
            craving.refetch();
            servers.refetch();
          }}
        />
      </Screen>
    );
  }
  const live = (servers.data ?? []).filter((s) => s.status === 'active' && s.is_live);
  return <CravingForm current={craving.data ?? null} servers={live} header={header} />;
}

function CravingForm({ current, servers, header }: { current: Craving | null; servers: ServerSummary[]; header: React.ReactNode }) {
  const t = useTheme();
  const settings = useMySettings();
  const setCraving = useSetCraving();
  const clear = useClearCraving();

  const { control, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(cravingSchema),
    defaultValues: {
      body: current?.body ?? '',
      hours: 24,
      serverId: current?.server_id && servers.some((s) => s.id === current.server_id) ? current.server_id : null,
    },
  });
  const body = watch('body');

  const currentScope = useMemo(() => {
    if (!current) return null;
    if (!current.server_id) return 'All your Servers';
    return current.server_name ?? servers.find((s) => s.id === current.server_id)?.name ?? 'One Server';
  }, [current, servers]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await setCraving.mutateAsync({ body: v.body, serverId: v.serverId, hours: v.hours });
      toast.success(current ? 'Craving updated' : 'Craving set');
      router.back();
    } catch (e) {
      toast.error(e);
    }
  });

  const onClear = async () => {
    const ok = await confirm({ title: 'Remove your craving?', message: 'It stops showing on your card and in matching straight away.', confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    clear.mutate(undefined, {
      onSuccess: () => {
        toast.success('Craving removed');
        router.back();
      },
      onError: toast.error,
    });
  };

  const vis = settings.data?.craving_visibility;

  return (
    <Screen
      header={header}
      edges={['top', 'bottom']}
      footer={<Button title={current ? 'Update craving' : 'Set craving'} size="lg" fullWidth loading={setCraving.isPending} onPress={() => { onSubmit(); }} />}>
      {current ? (
        <Card tone="brand" style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Ionicons name="flash" size={20} color={t.colors.accentStrong} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="micro" color="textTertiary">
                ACTIVE NOW
              </Text>
              <Text variant="body">{current.body}</Text>
              <Text variant="caption" color="textSecondary">
                {currentScope} · ends in {formatDistanceToNowStrict(new Date(current.expires_at))} ({format(new Date(current.expires_at), 'd MMM, h:mm a')})
              </Text>
            </View>
          </View>
          <Button title="Remove craving" size="sm" variant="danger" icon="trash-outline" loading={clear.isPending} onPress={onClear} />
        </Card>
      ) : null}

      <Text variant="callout" color="textSecondary">
        A craving is a short, temporary intent: what you are looking for right now. It helps Sniff.in match you with people who can help or join in.
      </Text>

      <View style={{ gap: 10 }}>
        <Controller
          control={control}
          name="body"
          render={({ field }) => (
            <TextField
              label={current ? 'Change your craving' : 'What are you craving?'}
              placeholder="Looking for a badminton partner"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              maxCount={140}
              multiline
              error={errors.body?.message}
            />
          )}
        />
        <TagList>
          {EXAMPLES.map((e) => (
            <Tag key={e} label={e} icon="add" selected={body === e} onPress={() => setValue('body', e, { shouldValidate: true, shouldDirty: true })} />
          ))}
        </TagList>
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="heading" accessibilityRole="header">
          Where
        </Text>
        <Controller
          control={control}
          name="serverId"
          render={({ field }) => (
            <RadioGroup<string>
              options={[
                { value: ALL, label: 'All my Servers' },
                ...servers.map((s) => ({ value: s.id, label: s.name, description: s.parent_name ? `in ${s.parent_name}` : undefined })),
              ]}
              value={field.value ?? ALL}
              onChange={(v) => field.onChange(v === ALL ? null : v)}
            />
          )}
        />
        {servers.length === 0 ? (
          <Text variant="caption" color="textTertiary">
            You are not in a live Server yet. Your craving still shows on your own card; join a Server to be matched on it.
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="heading" accessibilityRole="header">
          How long
        </Text>
        <Controller
          control={control}
          name="hours"
          render={({ field }) => <RadioGroup<number> options={DURATIONS} value={field.value} onChange={field.onChange} />}
        />
      </View>

      <Banner
        tone="info"
        icon="eye-outline"
        title="Who sees it"
        body={`Visible to ${vis ? VIS_TEXT[vis] : 'people who can see your card in that Server'}, per your Craving visibility setting. It disappears automatically when the time is up.`}
        action={{ label: 'Change visibility', onPress: () => router.push('/settings/privacy') }}
      />
    </Screen>
  );
}
