import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { Text, toast } from '@/components/ui';
import { useSignedUrl } from '@/features/media/hooks';
import { signedUrl, type Bucket } from '@/lib/upload';
import { gradients, useTheme } from '@/theme';
import type { Message } from '@/types/domain';
import { LinearGradient } from 'expo-linear-gradient';

import { ImageViewer } from './ImageViewer';
import { ProgressRing } from './ProgressRing';
import { Sticker, stickerLabel } from './stickers';

type Common = { msg: Message; mine: boolean; time: string; onRetry: () => void; onLongPress?: () => void; bucket?: Bucket };

const MEDIA_WIDTH = 240;
const absoluteFill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

function Meta({ msg, mine, time, tone = 'bubble' }: { msg: Message; mine: boolean; time: string; tone?: 'bubble' | 'plain' }) {
  const { colors } = useTheme();
  const onPrimary = mine && tone === 'bubble';
  const fg = onPrimary ? colors.onPrimary : colors.textTertiary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 4 }}>
      {msg.pending ? <Ionicons name="time-outline" size={12} color={fg} /> : null}
      <Text variant="micro" style={{ color: fg, opacity: onPrimary ? 0.75 : 1 }}>
        {msg.pending ? 'Sending' : msg.failed ? '' : time}
      </Text>
    </View>
  );
}

function bubbleStyle(mine: boolean, colors: ReturnType<typeof useTheme>['colors'], failed?: boolean) {
  return {
    maxWidth: '82%' as const, borderRadius: 18, borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6,
    backgroundColor: mine ? colors.primary : colors.surface, borderWidth: mine ? 0 : 1, borderColor: colors.border,
    opacity: failed ? 0.75 : 1,
  };
}

function who(mine: boolean) {
  return mine ? 'You' : 'Them';
}

// ---------------------------------------------------------------- text
function TextMessage({ msg, mine, time, onRetry, onLongPress }: Common) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={`${who(mine)}: ${msg.body}. ${msg.pending ? 'Sending' : msg.failed ? 'Not sent' : time}`}
      accessibilityHint={!mine ? 'Long press to report this message' : undefined}
      onPress={msg.failed ? onRetry : undefined}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={[bubbleStyle(mine, colors, msg.failed), { paddingHorizontal: 14, paddingTop: 9, paddingBottom: 6, gap: 3 }]}>
      <Text variant="body" selectable style={{ color: mine ? colors.onPrimary : colors.text }}>
        {msg.body}
      </Text>
      <Meta msg={msg} mine={mine} time={time} />
    </Pressable>
  );
}

// ---------------------------------------------------------------- image
function aspectOf(w?: number | null, h?: number | null) {
  if (!w || !h) return 1;
  return Math.max(0.6, Math.min(1.8, w / h));
}

export function ImageMessage({ msg, mine, time, onRetry, onLongPress, bucket = 'chat-media' }: Common) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const local = !!msg.local_uri;
  const signed = useSignedUrl(bucket, local ? null : msg.media_path);
  const uri = local ? msg.local_uri : signed.data;
  const uploading = !!msg.pending && local && msg.upload_progress !== undefined;
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 3 }}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`${who(mine)} sent a photo. ${msg.failed ? 'Not sent, tap to retry' : 'Tap to view full screen'}`}
        onPress={msg.failed ? onRetry : () => uri && setOpen(true)}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={{
          width: MEDIA_WIDTH, aspectRatio: aspectOf(msg.media_width, msg.media_height), borderRadius: 16, overflow: 'hidden',
          backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
        }}>
        {uri ? <Image source={{ uri }} contentFit="cover" transition={150} style={{ flex: 1 }} /> : signed.isError || (signed.isSuccess && !signed.data) ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Ionicons name="image-outline" size={28} color={colors.textTertiary} />
            <Text variant="caption" color="textTertiary">Photo unavailable</Text>
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
        {uploading || msg.failed ? (
          <View style={{ ...absoluteFill, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center' }}>
            {msg.failed ? <Ionicons name="refresh" size={30} color="#fff" /> : <ProgressRing value={msg.upload_progress ?? 0} />}
          </View>
        ) : null}
      </Pressable>
      <Meta msg={msg} mine={mine} time={time} tone="plain" />
      <ImageViewer uri={uri} visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

// ---------------------------------------------------------------- file
function fileIcon(mime?: string | null): { icon: keyof typeof Ionicons.glyphMap; color: string } {
  const m = mime ?? '';
  if (m === 'application/pdf') return { icon: 'document-text', color: '#D93A3A' };
  if (m.includes('word')) return { icon: 'document', color: '#0E7CC9' };
  if (m.includes('excel') || m.includes('spreadsheet')) return { icon: 'grid', color: '#1E9E5E' };
  if (m.includes('powerpoint') || m.includes('presentation')) return { icon: 'easel', color: '#F07A00' };
  return { icon: 'document-text-outline', color: '#615C6E' };
}

export function formatBytes(n?: number | null) {
  if (!n || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileMessage({ msg, mine, time, onRetry, onLongPress, bucket = 'chat-media' }: Common) {
  const { colors } = useTheme();
  const [opening, setOpening] = useState(false);
  const { icon, color } = fileIcon(msg.media_mime);
  const uploading = !!msg.pending && msg.upload_progress !== undefined;
  const open = async () => {
    if (!msg.media_path || opening) return;
    setOpening(true);
    try {
      const url = await signedUrl(bucket, msg.media_path);
      if (!url) throw new Error('unavailable');
      await WebBrowser.openBrowserAsync(url);
    } catch {
      toast.error('Couldn’t open this file. Please try again.');
    } finally {
      setOpening(false);
    }
  };
  const fg = mine ? colors.onPrimary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${who(mine)} sent a file: ${msg.media_name ?? 'file'} ${formatBytes(msg.media_size)}. ${msg.failed ? 'Not sent, tap to retry' : 'Tap to open'}`}
      onPress={msg.failed ? onRetry : msg.pending ? undefined : open}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={[bubbleStyle(mine, colors, msg.failed), { width: 260, padding: 10, gap: 6 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={24} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="callout" numberOfLines={1} style={{ color: fg }}>
            {msg.media_name ?? 'File'}
          </Text>
          <Text variant="caption" style={{ color: fg, opacity: 0.75 }} numberOfLines={1}>
            {[formatBytes(msg.media_size), (msg.media_mime ?? '').split('/').pop()?.split('.').pop()?.toUpperCase()].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {opening ? <ActivityIndicator color={fg} /> : msg.failed ? <Ionicons name="refresh" size={20} color={fg} /> : !msg.pending ? (
          <Ionicons name="open-outline" size={20} color={fg} />
        ) : null}
      </View>
      {uploading ? (
        <View accessibilityRole="progressbar" style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${Math.max(4, Math.round((msg.upload_progress ?? 0) * 100))}%`, backgroundColor: mine ? colors.onPrimary : colors.primary }} />
        </View>
      ) : null}
      <Meta msg={msg} mine={mine} time={time} />
    </Pressable>
  );
}

// ---------------------------------------------------------------- gif
export function GifMessage({ msg, mine, time, onRetry, onLongPress }: Common) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 3 }}>
      <Pressable
        accessibilityLabel={`${who(mine)} sent a GIF${msg.failed ? '. Not sent, tap to retry' : ''}`}
        onPress={msg.failed ? onRetry : undefined}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={{
          width: 220, aspectRatio: aspectOf(msg.media_width, msg.media_height), borderRadius: 16, overflow: 'hidden',
          backgroundColor: colors.surfaceMuted, opacity: msg.failed ? 0.75 : 1,
        }}>
        {msg.gif_url ? <Image source={{ uri: msg.gif_url }} autoplay contentFit="cover" transition={150} style={{ flex: 1 }} accessibilityLabel="GIF" /> : null}
        <View style={{ position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text variant="micro" style={{ color: '#fff' }}>GIF</Text>
        </View>
      </Pressable>
      <Meta msg={msg} mine={mine} time={time} tone="plain" />
    </View>
  );
}

// ---------------------------------------------------------------- sticker
export function StickerMessage({ msg, mine, time, onRetry, onLongPress }: Common) {
  const [fresh] = useState(() => Date.now() - new Date(msg.created_at).getTime() < 15_000);
  const id = msg.sticker_id ?? '';
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}>
      <Pressable
        accessibilityLabel={`${who(mine)} sent a ${stickerLabel(id)} sticker${msg.failed ? '. Not sent, tap to retry' : ''}`}
        onPress={msg.failed ? onRetry : undefined}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={{ opacity: msg.failed ? 0.6 : 1 }}>
        <Animated.View entering={fresh ? ZoomIn.springify().damping(12) : undefined}>
          <Sticker id={id} size={132} />
        </Animated.View>
      </Pressable>
      <Meta msg={msg} mine={mine} time={time} tone="plain" />
    </View>
  );
}

// ---------------------------------------------------------------- location
export function openInMaps(lat: number, lng: number) {
  const url = Platform.OS === 'ios'
    ? `http://maps.apple.com/?ll=${lat},${lng}&q=Shared%20location`
    : `https://maps.google.com/?q=${lat},${lng}`;
  Linking.openURL(url).catch(() => toast.error('Couldn’t open Maps on this device.'));
}

const fmtCoord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? pos : neg}`;

export function LocationMessage({ msg, mine, time, onRetry, onLongPress }: Common) {
  const { colors } = useTheme();
  const lat = msg.location_lat ?? null;
  const lng = msg.location_lng ?? null;
  const fg = mine ? colors.onPrimary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${who(mine)} shared a location. ${msg.failed ? 'Not sent, tap to retry' : 'Tap to open in Maps'}`}
      onPress={msg.failed ? onRetry : lat !== null && lng !== null ? () => openInMaps(lat, lng) : undefined}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={[bubbleStyle(mine, colors, msg.failed), { width: 250, padding: 10, gap: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <LinearGradient colors={gradients.peacock} style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="location" size={24} color="#fff" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text variant="callout" style={{ color: fg }}>Shared location</Text>
          {lat !== null && lng !== null ? (
            <Text variant="caption" style={{ color: fg, opacity: 0.75 }}>
              {fmtCoord(lat, 'N', 'S')}, {fmtCoord(lng, 'E', 'W')}
            </Text>
          ) : null}
        </View>
      </View>
      {!msg.pending && !msg.failed ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 36, borderRadius: 12, backgroundColor: mine ? 'rgba(255,255,255,0.18)' : colors.primarySoft }}>
          <Ionicons name="navigate" size={14} color={mine ? colors.onPrimary : colors.primary} />
          <Text variant="caption" style={{ color: mine ? colors.onPrimary : colors.primary }}>Open in Maps</Text>
        </View>
      ) : null}
      <Meta msg={msg} mine={mine} time={time} />
    </Pressable>
  );
}

/** Renders one message according to its kind. Unknown kinds (newer app versions) show a neutral placeholder. */
export function MessageContent(props: Common) {
  switch (props.msg.kind) {
    case 'image': return <ImageMessage {...props} />;
    case 'file': return <FileMessage {...props} />;
    case 'gif': return <GifMessage {...props} />;
    case 'sticker': return <StickerMessage {...props} />;
    case 'location': return <LocationMessage {...props} />;
    default:
      if (props.msg.body) return <TextMessage {...props} />;
      return <TextMessage {...props} msg={{ ...props.msg, body: 'Update the app to see this message.' }} />;
  }
}
