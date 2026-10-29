import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/session-store';
import { qk } from '@/lib/query-client';
import type { DiscoveryAudience, Gender, TagKind, UserSettings } from '@/types/domain';

import { profileApi, type ProfilePatch } from './api';

function useUid() {
  const uid = useUserId();
  return uid ?? '';
}

/** Owner preview ("what any member who isn't connected to me sees"). Lives under ['profile'] so it refreshes with it. */
export const myProfilePreviewKey = [...qk.profile('me'), 'preview'] as const;

/**
 * Everything that renders your own profile data (name, photo, text, tags, photos, prompts):
 * own row, every profile view (incl. the preview), and lists that show your card.
 */
export function invalidateMyProfile(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: qk.me });
  void qc.invalidateQueries({ queryKey: ['profile'] });
  void qc.invalidateQueries({ queryKey: ['discover'] });
  void qc.invalidateQueries({ queryKey: ['talk-matches'] });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
  void qc.invalidateQueries({ queryKey: ['server-directory'] });
  void qc.invalidateQueries({ queryKey: ['venue-people'] });
}

export function useMe() {
  const uid = useUid();
  return useQuery({ queryKey: qk.me, queryFn: () => profileApi.getMe(uid), enabled: !!uid });
}

export function useUpdateMe() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => profileApi.updateMe(uid, patch),
    onSuccess: () => invalidateMyProfile(qc),
  });
}

export function useSetUsername() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => profileApi.setUsername(username),
    onSuccess: () => invalidateMyProfile(qc),
  });
}

export function useMyPrivate() {
  const uid = useUid();
  return useQuery({ queryKey: qk.myPrivate, queryFn: () => profileApi.getPrivate(uid), enabled: !!uid });
}

export function useUpdateSafety() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { gender: Gender | null; audience: DiscoveryAudience; talkToGenders: Gender[] }) => profileApi.updateSafety(uid, v.gender, v.audience, v.talkToGenders),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.myPrivate });
      qc.invalidateQueries({ queryKey: ['discover'] });
    },
  });
}

export function useMySettings() {
  const uid = useUid();
  return useQuery({ queryKey: qk.mySettings, queryFn: () => profileApi.getSettings(uid), enabled: !!uid });
}

export function useUpdateSettings() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UserSettings>) => profileApi.updateSettings(uid, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.mySettings });
      const prev = qc.getQueryData<UserSettings>(qk.mySettings);
      if (prev) qc.setQueryData(qk.mySettings, { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(qk.mySettings, ctx.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.mySettings });
      // Visibility levels change what profiles (and your preview) show.
      void qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useMyTags() {
  const uid = useUid();
  return useQuery({ queryKey: qk.myTags, queryFn: profileApi.getMyTags, enabled: !!uid });
}

export function useSetTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, names }: { kind: TagKind; names: string[] }) => profileApi.setMyTags(kind, names),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.myTags });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['discover'] });
      qc.invalidateQueries({ queryKey: ['talk-matches'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useTagSearch(kind: TagKind, query: string) {
  return useQuery({
    queryKey: ['tags', kind, query],
    queryFn: () => profileApi.searchTags(kind, query),
    staleTime: 5 * 60_000,
  });
}

/** The universal profile. Opened from a Server it also carries that Server's context (role, member note, venue). */
export function useProfile(userId: string | undefined, serverId?: string) {
  return useQuery({
    queryKey: [...qk.profile(userId ?? ''), serverId ?? ''],
    queryFn: () => profileApi.getProfile(userId!, serverId),
    enabled: !!userId,
  });
}

/** Your profile exactly as any member who isn't connected to you sees it. */
export function usePreviewMyProfile() {
  const uid = useUid();
  return useQuery({ queryKey: myProfilePreviewKey, queryFn: profileApi.previewMyProfile, enabled: !!uid });
}

export function useResolveHandle(handle: string | undefined) {
  return useQuery({
    queryKey: ['profile-handle', handle ?? ''],
    queryFn: () => profileApi.resolveHandle(handle!),
    enabled: !!handle,
  });
}

export function useAddProfilePhoto() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uri: string) => profileApi.addPhoto(uid, uri),
    onSettled: () => invalidateMyProfile(qc),
  });
}

export function useRemoveProfilePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => profileApi.removePhoto(id),
    onSettled: () => invalidateMyProfile(qc),
  });
}

export function useSetPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; answer: string }) => profileApi.setPrompt(v.key, v.answer),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['profile'] }); },
  });
}

export function useMyCraving() {
  const uid = useUid();
  return useQuery({ queryKey: qk.myCraving, queryFn: () => profileApi.getMyCraving(uid), enabled: !!uid });
}

export function useSetCraving() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: string; serverId: string | null; hours: number }) => profileApi.setCraving(v.body, v.serverId, v.hours),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.myCraving });
      void qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useClearCraving() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: profileApi.clearCraving,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.myCraving });
      void qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useIsPlatformAdmin() {
  const uid = useUid();
  return useQuery({ queryKey: qk.isAdmin, queryFn: () => profileApi.isPlatformAdmin(uid), enabled: !!uid, staleTime: 10 * 60_000 });
}

/**
 * Per-viewer signed URL for a private avatar; null → show initials.
 * A null (not yet visible / not uploaded yet) is never trusted for long, so a photo appears as soon as it can.
 */
export function useAvatarUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: qk.avatar(path ?? ''),
    queryFn: () => profileApi.signedAvatarUrl(path!),
    enabled: !!path,
    staleTime: (q) => (q.state.data ? 50 * 60_000 : 0), // signed URLs live 60 min
    gcTime: 55 * 60_000,
  });
}

export function useUploadAvatar() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uri, previous }: { uri: string; previous: string | null }) => profileApi.uploadAvatar(uid, uri, previous),
    onSuccess: () => invalidateMyProfile(qc),
  });
}

export function useRemoveAvatar() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => profileApi.removeAvatar(uid, path),
    onSuccess: () => invalidateMyProfile(qc),
  });
}

export function useMyEndorsements() {
  const uid = useUid();
  return useQuery({ queryKey: qk.endorsements, queryFn: () => profileApi.myEndorsements(uid), enabled: !!uid });
}

export function useSetEndorsementStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: 'approved' | 'hidden' }) => profileApi.setEndorsementStatus(v.id, v.status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.endorsements });
      void qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useWriteEndorsement() {
  return useMutation({ mutationFn: (v: { userId: string; body: string }) => profileApi.writeEndorsement(v.userId, v.body) });
}

export const useEndorsementList = (direction: 'received' | 'written') =>
  useQuery({ queryKey: [...qk.endorsements, direction], queryFn: () => profileApi.listEndorsements(direction) });

export function useRevokeEndorsement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => profileApi.revokeEndorsement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.endorsements });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export const useOrgSearch = (query: string, kind: 'college' | 'employer' | null) =>
  useQuery({ queryKey: ['orgs', kind, query], queryFn: () => profileApi.searchOrgs(query, kind), enabled: query.trim().length >= 2, staleTime: 5 * 60_000 });

export const useStartAffiliation = () =>
  useMutation({ mutationFn: (v: { email: string; kind: 'college' | 'employer'; orgName: string | null }) => profileApi.startAffiliation(v.email, v.kind, v.orgName) });

export function useConfirmAffiliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { verificationId: string; code: string }) => profileApi.confirmAffiliation(v.verificationId, v.code),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
}

export function useRemoveAffiliation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => profileApi.removeAffiliation(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }) });
}
