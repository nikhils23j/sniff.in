import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AffiliationBadge } from '@/components/AffiliationBadge';
import { SocialLinks, validSocials } from '@/components/SocialLinks';
import {
  Avatar, Card, IconButton, ListGroup, ListRow, SectionHeader, SelfReported, Tag, TagList, Text, VerifiedBadge,
} from '@/components/ui';
import { useSignedUrl, useThumbnailUrl } from '@/features/media/hooks';
import { promptTitle } from '@/features/profile/prompts';
import { relativeTime } from '@/features/social/chat-extra';
import { useTheme } from '@/theme';
import type { MemberRole, ProfileView, TagKind } from '@/types/domain';

const KIND_LABEL: Record<TagKind, string> = {
  interest: 'Interests', hobby: 'Hobbies', skill: 'Skills', language: 'Languages', career: 'Career',
};
const ABOUT_KINDS: TagKind[] = ['interest', 'hobby', 'language'];
const WORK_KINDS: TagKind[] = ['skill', 'career'];
const ROLE_LABEL: Record<MemberRole, string> = { admin: 'Admin', moderator: 'Moderator', member: 'Member' };

function joinList(items: string[]) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function safeFormat(iso: string | null | undefined, pattern: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, pattern);
}

// ------------------------------------------------------------------ photos

function PhotoThumb({ path, index, onOpen }: { path: string; index: number; onOpen: (index: number) => void }) {
  const url = useThumbnailUrl('profile-photos', path);
  const { colors, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={`Open photo ${index + 1}`}
      onPress={() => onOpen(index)}
      style={({ pressed }) => ({
        width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.85 : 1,
      })}>
      {url.data ? <Image source={{ uri: url.data }} style={{ flex: 1 }} contentFit="cover" transition={120} /> : null}
    </Pressable>
  );
}

function FullPhoto({ path, width, height }: { path: string; width: number; height: number }) {
  const url = useSignedUrl('profile-photos', path);
  const { colors } = useTheme();
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      {url.data ? (
        <Image source={{ uri: url.data }} style={{ width, height }} contentFit="contain" transition={150} accessibilityLabel="Profile photo" />
      ) : url.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Text variant="callout" color="textSecondary">This photo isn&apos;t available right now.</Text>
      )}
    </View>
  );
}

function PhotoPager({ paths, start, onPage }: { paths: string[]; start: number; onPage: (page: number) => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scroller = useRef<ScrollViewInstance>(null);
  const positioned = useRef(false);
  const photoHeight = Math.max(200, height - insets.top - insets.bottom - 72);
  return (
    <ScrollView
      ref={scroller}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onLayout={() => {
        if (positioned.current) return;
        positioned.current = true;
        scroller.current?.scrollTo({ x: start * width, y: 0, animated: false });
      }}
      onMomentumScrollEnd={(e) => onPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
      {paths.map((p) => <FullPhoto key={p} path={p} width={width} height={photoHeight} />)}
    </ScrollView>
  );
}

/** Full-screen, swipeable photo viewer. */
function PhotoViewer({ paths, start, onClose }: { paths: string[]; start: number | null; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<number | null>(null);
  const current = page ?? start ?? 0;
  const close = () => { setPage(null); onClose(); };
  return (
    <Modal visible={start !== null} animationType="fade" onRequestClose={close} presentationStyle="fullScreen">
      <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, minHeight: 56 }}>
          <Text variant="callout" color="textSecondary">
            {paths.length > 1 ? `${current + 1} / ${paths.length}` : ''}
          </Text>
          <IconButton icon="close" label="Close photo" onPress={close} />
        </View>
        {start !== null ? <PhotoPager paths={paths} start={start} onPage={setPage} /> : null}
      </View>
    </Modal>
  );
}

// ------------------------------------------------------------------ small pieces

function IconLine({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={colors.textSecondary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>{children}</View>
    </View>
  );
}

function Labelled({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="micro" color="textTertiary">{label.toUpperCase()}</Text>
      <Text variant="callout">{value}</Text>
    </View>
  );
}

function TagGroups({ profile, kinds }: { profile: ProfileView; kinds: TagKind[] }) {
  const shared = new Set(profile.shared_tags ?? []);
  const groups = kinds.map((kind) => ({ kind, tags: profile.tags.filter((t) => t.kind === kind) })).filter((g) => g.tags.length);
  if (!groups.length) return null;
  return (
    <View style={{ gap: 12 }}>
      {groups.map((g) => (
        <View key={g.kind} style={{ gap: 6 }}>
          <Text variant="micro" color="textTertiary">{KIND_LABEL[g.kind].toUpperCase()}</Text>
          <TagList>
            {g.tags.map((t) => (
              <Tag
                key={`${t.kind}-${t.name}`}
                label={t.name}
                small
                tone={shared.has(t.name) ? 'brand' : 'neutral'}
                icon={shared.has(t.name) ? 'sparkles' : undefined}
              />
            ))}
          </TagList>
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ body

export type ProfileBodyProps = {
  profile: ProfileView;
  /** false for previews: links, photos and endorsement authors still render but don't navigate away. */
  interactive?: boolean;
  /** Rendered under the header (relationship actions, banners). */
  actions?: React.ReactNode;
  /** Rendered after everything else (endorse / feedback). */
  footer?: React.ReactNode;
  onAvatarPress?: () => void;
  onFriendsPress?: () => void;
};

/**
 * The one universal profile layout: the same for other people, for your own profile and for every preview.
 * Sections the viewer can't see (or that are empty) are simply left out.
 */
export function ProfileBody({ profile: p, interactive = true, actions, footer, onAvatarPress, onFriendsPress }: ProfileBodyProps) {
  const t = useTheme();
  const { colors, radius } = t;
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);

  const tags = p.tags ?? [];
  const photos = [...(p.photos ?? [])].sort((a, b) => a.position - b.position);
  const prompts = p.prompt_answers ?? [];
  const badges = p.badges ?? [];
  const affiliations = p.affiliations ?? [];
  const endorsements = p.endorsements ?? [];
  const sharedTags = p.shared_tags ?? [];
  const socials = validSocials(p);
  const ctx = p.server_context ?? null;
  const rel = p.relationship;

  const hasAboutTags = tags.some((tg) => ABOUT_KINDS.includes(tg.kind));
  const hasWorkTags = tags.some((tg) => WORK_KINDS.includes(tg.kind));
  const hasAbout = !!(p.bio || p.social_preferences || hasAboutTags || prompts.length);
  const hasWork = !!(
    p.professional_bio || p.occupation || p.university || p.school_name || p.job_title || p.workplace || p.work_experience || p.professional_interests || p.career_goals
    || hasWorkTags || affiliations.length
  );
  const hasDetails = !!(p.height_cm || p.hometown || p.relationship_status);
  const venueUntil = safeFormat(p.venue_expires_at, 'h:mm a');
  const joined = safeFormat(ctx?.joined_at, 'MMM yyyy');
  const noteLabel = ctx?.member_field_label?.trim() || 'Note';
  const isEmpty = !hasAbout && !hasWork && !hasDetails && !photos.length && !socials.length && !p.craving && !badges.length && !endorsements.length;

  return (
    <View style={{ gap: t.spacing.lg }}>
      {/* header */}
      <View style={{ alignItems: 'center', gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, width: '100%' }}>
          <Pressable accessibilityRole={onAvatarPress ? 'button' : undefined} accessibilityLabel={onAvatarPress ? 'Preview your profile' : undefined} onPress={onAvatarPress} disabled={!onAvatarPress}>
            <Avatar path={p.avatar_path} name={p.display_name} size={104} available={!!p.available} />
          </Pressable>
          <View style={{ alignItems: 'center', gap: 7, maxWidth: '55%' }}>
            <Pressable accessibilityRole={onFriendsPress ? 'button' : undefined} accessibilityLabel={`${p.connection_count ?? 0} friends${onFriendsPress ? ', view friend list' : ''}`}
              onPress={onFriendsPress} disabled={!onFriendsPress} style={{ alignItems: 'center' }}>
              <Text variant="title">{p.connection_count ?? 0}</Text>
              <Text variant="caption" color="textSecondary">Friends</Text>
            </Pressable>
            {badges.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                {badges.map((b) => <VerifiedBadge key={b.id} label={b.label} serverName={b.server_name} official={b.server_is_official} />)}
              </View>
            ) : null}
          </View>
        </View>
        <Text variant="title" align="center" style={{ marginTop: 6 }}>
          {p.display_name}
        </Text>
        <Text variant="callout" color="textTertiary">
          @{p.username}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          {p.available ? (
            <View accessible accessibilityLabel="Available now" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.successSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }} />
              <Text variant="caption" style={{ color: colors.success }}>Available now</Text>
            </View>
          ) : null}
          {rel?.state === 'connected' && rel.is_friend ? <Tag label="Friend" icon="heart" tone="accent" small /> : null}
          {rel?.state === 'connected' && !rel.is_friend ? <Tag label="Connected" icon="link" tone="brand" small /> : null}
        </View>
      </View>

      {actions}

      {/* where you met: Server context and venue status */}
      {p.venue_topic || p.venue_location_hint ? (
        <Card tone="brand" style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="chatbubbles-outline" size={18} color={colors.primary} />
            <Text variant="subheading" style={{ flex: 1 }}>Open to Talk here</Text>
            {venueUntil ? <Text variant="caption" color="textSecondary">until {venueUntil}</Text> : null}
          </View>
          {p.venue_topic ? <Text variant="body">{p.venue_topic}</Text> : null}
          {p.venue_location_hint ? (
            <IconLine icon="location-outline"><Text variant="callout" color="textSecondary">{p.venue_location_hint}</Text></IconLine>
          ) : null}
        </Card>
      ) : null}

      {ctx ? (
        <Card tone="muted" style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name={ctx.kind === 'short_term' ? 'calendar-outline' : 'people-outline'} size={18} color={colors.textSecondary} />
            <Text variant="subheading" numberOfLines={1} style={{ flex: 1 }}>
              {ctx.server_name}
            </Text>
            {ctx.role ? <Tag label={ROLE_LABEL[ctx.role]} small tone={ctx.role === 'member' ? 'neutral' : 'brand'} /> : null}
          </View>
          {ctx.member_note?.trim() ? (
            <Text variant="callout">
              <Text variant="callout" color="textSecondary">{noteLabel}: </Text>
              {ctx.member_note.trim()}
            </Text>
          ) : null}
          {joined ? <Text variant="caption" color="textTertiary">Member since {joined}</Text> : null}
        </Card>
      ) : null}

      {/* extra photos */}
      {photos.length ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Photos" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {photos.map((photo, i) => <PhotoThumb key={photo.id} path={photo.storage_path} index={i} onOpen={setPhotoIndex} />)}
          </ScrollView>
        </View>
      ) : null}

      {/* craving */}
      {p.craving ? (
        <View style={{ flexDirection: 'row', gap: 10, backgroundColor: colors.accentSoft, padding: 14, borderRadius: radius.lg, alignItems: 'flex-start' }}>
          <Ionicons name="flash" size={18} color={colors.accentStrong} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="micro" color="textSecondary">RIGHT NOW</Text>
            <Text variant="body">{p.craving.body}</Text>
            <Text variant="caption" color="textSecondary">
              {p.craving.server_name ? `In ${p.craving.server_name} · ` : ''}ends {relativeTime(p.craving.expires_at)}
            </Text>
          </View>
        </View>
      ) : null}

      {sharedTags.length ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Ionicons name="sparkles" size={16} color={colors.primary} style={{ marginTop: 3 }} />
          <Text variant="callout" style={{ flex: 1 }}>
            You both like {joinList(sharedTags)}.
          </Text>
        </View>
      ) : null}

      {hasDetails ? (
        <View style={{ gap: 10 }}>
          <SectionHeader title="A little more" />
          <Card style={{ gap: 12 }}>
            {p.height_cm ? <IconLine icon="resize-outline"><Text variant="callout">{p.height_cm} cm</Text><SelfReported /></IconLine> : null}
            {p.hometown ? <IconLine icon="home-outline"><Text variant="callout">From {p.hometown}</Text><SelfReported /></IconLine> : null}
            {p.relationship_status ? <IconLine icon="heart-outline"><Text variant="callout">{p.relationship_status.replaceAll('_', ' ')}</Text><SelfReported /></IconLine> : null}
          </Card>
        </View>
      ) : null}

      {/* about */}
      {hasAbout ? (
        <View style={{ gap: 10 }}>
          <SectionHeader title="About" />
          {p.bio || p.social_preferences || hasAboutTags ? (
            <Card style={{ gap: 14 }}>
              {p.bio ? <Text variant="body">{p.bio}</Text> : null}
              {p.social_preferences ? <Labelled label="Conversation interests" value={p.social_preferences} /> : null}
              <TagGroups profile={p} kinds={ABOUT_KINDS} />
            </Card>
          ) : null}
          {prompts.map((answer) => (
            <Card key={answer.prompt_key} tone="brand" style={{ gap: 5 }}>
              <Text variant="caption" color="primary">{promptTitle(answer.prompt_key)}</Text>
              <Text variant="body">{answer.answer}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      {/* work & study */}
      {hasWork ? (
        <View style={{ gap: 10 }}>
          <SectionHeader title="Work & study" />
          <Card style={{ gap: 14 }}>
            {p.professional_bio ? <Text variant="body">{p.professional_bio}</Text> : null}
            {p.job_title || p.workplace || p.occupation ? (
              <IconLine icon="briefcase-outline">
                <Text variant="callout">{[p.job_title, p.workplace].filter(Boolean).join(' at ') || p.occupation}</Text>
                <SelfReported />
              </IconLine>
            ) : null}
            {p.school_name || p.university ? (
              <IconLine icon="school-outline">
                <Text variant="callout">{p.school_name || p.university}{p.education_level ? ` · ${p.education_level.replaceAll('_', ' ')}` : ''}</Text>
                <SelfReported />
              </IconLine>
            ) : null}
            {p.work_experience ? <Labelled label="Experience" value={p.work_experience} /> : null}
            {p.professional_interests ? <Labelled label="Professional interests" value={p.professional_interests} /> : null}
            {p.career_goals ? <Labelled label="Career goals" value={p.career_goals} /> : null}
            <TagGroups profile={p} kinds={WORK_KINDS} />
            {affiliations.length ? (
              <View style={{ gap: 8 }}>
                {affiliations.map((a) => <AffiliationBadge key={a.id} affiliation={a} />)}
              </View>
            ) : null}
          </Card>
        </View>
      ) : null}

      {/* links */}
      {socials.length ? (
        <View style={{ gap: 10 }}>
          <SectionHeader title="Links" />
          <SocialLinks links={socials} interactive={interactive} />
        </View>
      ) : p.socials_hidden ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Links" />
          <ListGroup>
            <ListRow icon="lock-closed-outline" title="Links are shared after connecting" subtitle="Instagram, LinkedIn and other links appear once you connect." chevron={false} />
          </ListGroup>
        </View>
      ) : null}

      {/* endorsements */}
      {endorsements.length ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Endorsements" />
          {endorsements.map((e) => (
            <Card
              key={e.id}
              onPress={interactive ? () => router.push(`/user/${e.author.id}`) : undefined}
              accessibilityLabel={interactive ? `Endorsement from ${e.author.display_name}. Open their profile` : `Endorsement from ${e.author.display_name}`}
              style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar path={e.author.avatar_path} name={e.author.display_name} size={36} />
                <View style={{ flex: 1 }}>
                  <Text variant="callout" numberOfLines={1}>{e.author.display_name}</Text>
                  <Text variant="caption" color="textTertiary" numberOfLines={1}>
                    @{e.author.username} · {relativeTime(e.created_at)}
                  </Text>
                </View>
                {interactive ? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /> : null}
              </View>
              <Text variant="body">&ldquo;{e.body}&rdquo;</Text>
            </Card>
          ))}
        </View>
      ) : null}

      {isEmpty ? (
        <Text variant="callout" color="textTertiary" align="center">
          Nothing else to show yet.
        </Text>
      ) : null}

      {footer}

      <PhotoViewer paths={photos.map((ph) => ph.storage_path)} start={photoIndex} onClose={() => setPhotoIndex(null)} />
    </View>
  );
}
