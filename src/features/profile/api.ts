import * as Crypto from 'expo-crypto';

import { AppError, toAppError } from '@/lib/errors';
import { rpc, run } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';
import { finalizeMediaUpload, prepareImage, randomFileName, thumbnailPath, uploadWithProgress } from '@/lib/upload';
import type {
  AffiliationStart, EndorsementItem, OrgDomain,
  Craving, DiscoveryAudience, Endorsement, Gender, MyPrivate, MyProfile, ProfileView, Tag, TagKind, UserSettings,
} from '@/types/domain';
import type { OnboardingDraft } from '@/features/onboarding/store';

export type ProfilePatch = Partial<Pick<MyProfile,
  'display_name' | 'bio' | 'university' | 'occupation' | 'career_goals' | 'website_url' |
  'instagram_handle' | 'linkedin_url' | 'avatar_path' | 'professional_bio' |
  'work_experience' | 'social_preferences' | 'professional_interests' | 'height_cm' | 'education_level' |
  'school_name' | 'workplace' | 'job_title' | 'hometown' | 'relationship_status' | 'drinking' | 'smoking'>>;

export const profileApi = {
  async getMe(userId: string): Promise<MyProfile | null> {
    return run(supabase.from('profiles').select('*').eq('id', userId).maybeSingle()) as Promise<MyProfile | null>;
  },

  async updateMe(userId: string, patch: ProfilePatch) {
    // Empty strings become NULL so DB check constraints and "not set" states stay clean.
    const clean = Object.fromEntries(
      Object.entries(patch).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v]),
    );
    await run(supabase.from('profiles').update(clean).eq('id', userId));
  },

  getPrivate: (userId: string) =>
    run(supabase.from('profile_private').select('date_of_birth, gender, discovery_audience, talk_to_genders').eq('user_id', userId).single()) as Promise<MyPrivate>,

  updateSafety: (userId: string, gender: Gender | null, audience: DiscoveryAudience, talkToGenders: Gender[]) =>
    run(supabase.from('profile_private').update({ gender, discovery_audience: audience, talk_to_genders: talkToGenders }).eq('user_id', userId)),

  getSettings: (userId: string) =>
    run(supabase.from('user_settings').select('*').eq('user_id', userId).single()) as Promise<UserSettings>,

  updateSettings: (userId: string, patch: Partial<UserSettings>) =>
    run(supabase.from('user_settings').update(patch).eq('user_id', userId)),

  completeOnboarding: (args: {
    username: string; displayName: string; dateOfBirth: string; gender: Gender | null; audience: DiscoveryAudience;
  }) =>
    rpc<void>('complete_onboarding', {
      p_username: args.username, p_display_name: args.displayName, p_date_of_birth: args.dateOfBirth,
      p_gender: args.gender, p_discovery_audience: args.audience,
    }),

  completeOnboardingProfile: (draft: OnboardingDraft) => rpc<void>('complete_onboarding_profile', { p_payload: {
    username: draft.username, display_name: draft.displayName, date_of_birth: draft.dateOfBirth,
    gender: draft.gender, discovery_audience: draft.audience, talk_to_genders: draft.talkToGenders,
    height_cm: draft.heightCm, education_level: draft.educationLevel, school_name: draft.schoolName,
    workplace: draft.workplace, job_title: draft.jobTitle, hometown: draft.hometown,
    relationship_status: draft.relationshipStatus, drinking: draft.drinking, smoking: draft.smoking,
    visibility: draft.visibility,
  } }),

  isUsernameAvailable: (username: string) => rpc<boolean>('is_username_available', { p_username: username }),
  setUsername: (username: string) => rpc<void>('set_username', { p_username: username }),

  getMyTags: () => rpc<Tag[]>('get_my_tags'),
  setMyTags: (kind: TagKind, names: string[]) => rpc<void>('set_my_tags', { p_kind: kind, p_names: names }),
  searchTags: (kind: TagKind, query: string) =>
    rpc<{ name: string; uses: number }[]>('search_tags', { p_kind: kind, p_query: query, p_limit: 12 }),

  /**
   * Opened from a Server, the profile also carries that Server's context. If the in-Server view isn't available
   * (they left, are still pending, or the Server ended) fall back to the plain profile, which has its own rules.
   */
  async getProfile(userId: string, serverId?: string): Promise<ProfileView> {
    if (serverId) {
      try {
        return await rpc<ProfileView>('get_profile_in_server', { p_user_id: userId, p_server_id: serverId });
      } catch (error) {
        if (toAppError(error).code !== 'not_found') throw error;
      }
    }
    return rpc<ProfileView>('get_profile', { p_user_id: userId });
  },
  /** Your own profile exactly as any member who isn't connected to you sees it. */
  previewMyProfile: () => rpc<ProfileView>('preview_my_profile'),
  resolveHandle: (handle: string) => rpc<string | null>('resolve_profile_handle', { p_handle: handle }),
  setPrompt: (key: string, answer: string) => rpc<void>('set_profile_prompt', { p_key: key, p_answer: answer }),
  /** The server picks the first free slot (1–6) and raises `too_many_photos` when all are taken. */
  addPhoto: async (userId: string, uri: string) => {
    const image = await prepareImage(uri, 1280);
    const path = `${userId}/${randomFileName('jpg')}`;
    const thumbPath = thumbnailPath(path)!;
    await uploadWithProgress({ bucket: 'profile-photos', path, uri: image.uri, contentType: image.mime });
    try {
      const thumb = await prepareImage(uri, 240);
      await uploadWithProgress({ bucket: 'profile-photos', path: thumbPath, uri: thumb.uri, contentType: thumb.mime });
      const id = await rpc<string>('add_profile_photo', { p_path: path, p_position: null });
      void finalizeMediaUpload('profile-photos', path).catch(() => {});
      void finalizeMediaUpload('profile-photos', thumbPath).catch(() => {});
      return id;
    } catch (error) {
      await supabase.storage.from('profile-photos').remove([path, thumbPath]);
      throw error;
    }
  },
  removePhoto: (id: string) => rpc<void>('remove_profile_photo', { p_photo_id: id }),

  async getMyCraving(userId: string): Promise<Craving | null> {
    const row = await run(
      supabase.from('cravings').select('body, expires_at, server_id').eq('user_id', userId).gt('expires_at', new Date().toISOString()).maybeSingle(),
    );
    return row as Craving | null;
  },
  setCraving: (body: string, serverId: string | null, hours: number) =>
    rpc<void>('set_craving', { p_body: body, p_server_id: serverId, p_hours: hours }),
  clearCraving: () => rpc<void>('clear_craving'),

  async myEndorsements(userId: string): Promise<(Endorsement & { author_name?: string })[]> {
    return run(supabase.from('endorsements').select('*').eq('subject_id', userId).order('created_at', { ascending: false })) as Promise<Endorsement[]>;
  },
  writeEndorsement: (userId: string, body: string) => rpc<string>('write_endorsement', { p_user_id: userId, p_body: body }),
  setEndorsementStatus: (id: string, status: 'approved' | 'hidden') =>
    rpc<void>('set_endorsement_status', { p_endorsement_id: id, p_status: status }),

  listEndorsements: (direction: 'received' | 'written') => rpc<EndorsementItem[]>('list_endorsements', { p_direction: direction }),
  revokeEndorsement: (id: string) => rpc<void>('revoke_endorsement', { p_endorsement_id: id }),

  searchOrgs: (query: string, kind: 'college' | 'employer' | null) =>
    rpc<OrgDomain[]>('search_org_domains', { p_query: query, p_kind: kind }),
  async startAffiliation(email: string, kind: 'college' | 'employer', orgName: string | null): Promise<AffiliationStart> {
    const { data, error } = await supabase.functions.invoke('affiliation-verify', {
      body: { action: 'start', email, kind, org_name: orgName },
    });
    if (error) throw await functionError(error);
    return data as AffiliationStart;
  },
  async confirmAffiliation(verificationId: string, code: string) {
    const { data, error } = await supabase.functions.invoke('affiliation-verify', {
      body: { action: 'confirm', verification_id: verificationId, code },
    });
    if (error) throw await functionError(error);
    return data as { verified: true };
  },
  removeAffiliation: (id: string) => run(supabase.from('verified_affiliations').delete().eq('id', id)),

  async isPlatformAdmin(userId: string): Promise<boolean> {
    const row = await run(supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle());
    return !!row;
  },

  /** Resize → JPEG → upload to avatars/<uid>/<random>.jpg → point profile at it → delete the old file. */
  async uploadAvatar(userId: string, localUri: string, _previousPath: string | null): Promise<string> {
    const resized = await prepareImage(localUri, 640);
    const path = `${userId}/${Crypto.randomUUID()}.jpg`;
    await uploadWithProgress({ bucket: 'avatars', path, uri: resized.uri, contentType: resized.mime });
    await profileApi.updateMe(userId, { avatar_path: path });
    void finalizeMediaUpload('avatars', path).catch(() => {});
    return path;
  },

  async removeAvatar(userId: string, _path: string) {
    await profileApi.updateMe(userId, { avatar_path: null });
  },

  async signedAvatarUrl(path: string): Promise<string | null> {
    const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, 3600);
    if (error) return null; // not authorised / missing → initials fallback
    return data.signedUrl;
  },
};

const AFFILIATION_ERRORS: Record<string, string> = {
  invalid_email: 'Enter a valid email address.',
  personal_email_not_allowed: 'Use your college or work email, not a personal address (Gmail, Outlook…).',
  domain_cannot_receive_email: "That domain can't receive email. Check for typos.",
  not_an_academic_domain: "We couldn't confirm that's a college email domain.",
  email_not_configured: 'Email verification is not available yet.',
  email_send_failed: "We couldn't send the email. Try again in a moment.",
  rate_limited: 'Too many attempts today. Try again tomorrow.',
  wrong_code: "That code isn't right.",
  code_expired: 'That code expired. Request a new one.',
  too_many_attempts: 'Too many attempts. Request a new code.',
  not_found: 'This verification is no longer valid. Start again.',
  mailbox_already_used: 'That email address is already verified on another Sniff.in account.',
};

/** Edge Functions return { error: code }; map to friendly copy. */
async function functionError(error: unknown): Promise<AppError> {
  try {
    const ctx = (error as { context?: Response }).context;
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
    const code = (body as { error?: string } | null)?.error;
    if (code) return new AppError(code, AFFILIATION_ERRORS[code] ?? 'Something went wrong. Please try again.');
  } catch {
    /* fall through */
  }
  return toAppError(error);
}
