import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/session-store';
import { qk } from '@/lib/query-client';
import type { BadgeKind, MemberRole, MemberStatus, ProfileMode, ReportStatus } from '@/types/domain';

import { serversApi, type CreateServerInput, type JoinPreferences, type ServerMessageFields, type ServerSettingsPatch } from './api';

export const useMyServers = () => useQuery({ queryKey: qk.myServers, queryFn: serversApi.listMine });

export const useServer = (id: string | undefined) =>
  useQuery({ queryKey: qk.server(id ?? ''), queryFn: () => serversApi.get(id!), enabled: !!id });

export const useServerSearch = (query: string) =>
  useQuery({ queryKey: qk.serverSearch(query), queryFn: () => serversApi.search(query), staleTime: 60_000 });

/**
 * Everything that depends on Server membership, roles, badges, member notes or on-site sessions.
 * Keys: ['servers', …] (my servers, detail, members, stats), ['server-directory', id], ['venue-people', id],
 * ['venue-session', id], ['venue-nearby', …], ['hot-map', …], ['discover', id], ['dashboard'], ['talk-matches'].
 */
function invalidateServerData(qc: QueryClient, id?: string) {
  qc.invalidateQueries({ queryKey: ['servers'] });
  if (id) {
    qc.invalidateQueries({ queryKey: qk.discover(id) });
    qc.invalidateQueries({ queryKey: ['server-directory', id] });
    qc.invalidateQueries({ queryKey: ['venue-people', id] });
    qc.invalidateQueries({ queryKey: ['venue-session', id] });
  } else {
    qc.invalidateQueries({ queryKey: ['discover'] });
    qc.invalidateQueries({ queryKey: ['server-directory'] });
    qc.invalidateQueries({ queryKey: ['venue-people'] });
    qc.invalidateQueries({ queryKey: ['venue-session'] });
  }
  qc.invalidateQueries({ queryKey: ['venue-nearby'] });
  qc.invalidateQueries({ queryKey: ['hot-map'] });
  qc.invalidateQueries({ queryKey: ['activity'] });
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  qc.invalidateQueries({ queryKey: ['talk-matches'] });
}

function useInvalidateServers() {
  const qc = useQueryClient();
  return (id?: string) => invalidateServerData(qc, id);
}

export function useCreateServer() {
  const invalidate = useInvalidateServers();
  return useMutation({ mutationFn: (i: CreateServerInput) => serversApi.create(i), onSuccess: () => invalidate() });
}

export function useUpdateServer(id: string) {
  const invalidate = useInvalidateServers();
  return useMutation({ mutationFn: (p: ServerSettingsPatch) => serversApi.update(id, p), onSuccess: () => invalidate(id) });
}

export function useArchiveServer(id: string) {
  const invalidate = useInvalidateServers();
  return useMutation({ mutationFn: () => serversApi.archive(id), onSuccess: () => invalidate(id) });
}

export const usePreviewToken = () => useMutation({ mutationFn: (token: string) => serversApi.previewToken(token) });

export function useJoinWithToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: JoinPreferences) => serversApi.joinWithToken(v),
    onSuccess: async (r) => {
      invalidateServerData(qc, r.status === 'invalid' ? undefined : r.server_id);
      // Wait for My Servers so Home already knows the new Server when the join screen selects it and navigates.
      if (r.status === 'active') await qc.refetchQueries({ queryKey: qk.myServers }).catch(() => {});
    },
  });
}

export const useServerDirectory = (id: string) => useInfiniteQuery({
  queryKey: ['server-directory', id], queryFn: ({ pageParam }) => serversApi.directory(id, pageParam),
  initialPageParam: 0, getNextPageParam: (last, all) => last.length < 50 ? undefined : all.length * 50, enabled: !!id,
});

export function useSetServerProfile(id: string) {
  const invalidate = useInvalidateServers();
  return useMutation({ mutationFn: (v: { mode: ProfileMode; note: string | null }) => serversApi.setProfile(id, v.mode, v.note),
    onSuccess: () => invalidate(id) });
}

export const useVenuePeople = (id: string) => useQuery({ queryKey: ['venue-people', id],
  queryFn: () => serversApi.venuePeople(id), enabled: !!id, refetchInterval: 60_000 });
export const useMyVenueSession = (id: string) => useQuery({ queryKey: ['venue-session', id],
  queryFn: () => serversApi.myVenueSession(id), enabled: !!id, refetchInterval: 60_000 });
export type VenueSessionInput = { open: boolean; minutes: number; topic: string | null; locationHint: string | null; mode?: ProfileMode };
/** Starts / renews / pauses my on-site session. Profiles are one universal view, so mode defaults to 'both'. */
export function useSetVenueSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: VenueSessionInput) => serversApi.setVenueSession(id, { ...v, mode: v.mode ?? 'both' }),
    onSuccess: () => {
      invalidateServerData(qc, id);
      // Opening a venue session also marks me Available server-side.
      qc.invalidateQueries({ queryKey: qk.presence });
    },
  });
}
export function useEndVenueSession(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => serversApi.endVenueSession(id), onSuccess: () => invalidateServerData(qc, id) });
}

export function useRequestToJoin() {
  const invalidate = useInvalidateServers();
  return useMutation({ mutationFn: (id: string) => serversApi.requestToJoin(id), onSuccess: (_r, id) => invalidate(id) });
}

export function useLeaveServer() {
  const invalidate = useInvalidateServers();
  return useMutation({ mutationFn: (id: string) => serversApi.leave(id), onSuccess: (_r, id) => invalidate(id) });
}

export function useSetDiscoverable(id: string) {
  const uid = useUserId() ?? '';
  const invalidate = useInvalidateServers();
  return useMutation({ mutationFn: (v: boolean) => serversApi.setDiscoverable(id, uid, v), onSuccess: () => invalidate(id) });
}

// ---------------------------------------------------------------- admin
export const useJoinTokens = (id: string) =>
  useQuery({ queryKey: qk.serverTokens(id), queryFn: () => serversApi.listTokens(id), enabled: !!id });

export function useCreateToken(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: 'qr' | 'link' | 'code'; expiresMinutes: number | null; maxUses: number | null; label: string | null }) =>
      serversApi.createToken(id, v.kind, v.expiresMinutes, v.maxUses, v.label),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.serverTokens(id) }),
  });
}

export function useRevokeToken(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (tokenId: string) => serversApi.revokeToken(tokenId), onSuccess: () => qc.invalidateQueries({ queryKey: qk.serverTokens(id) }) });
}

export const useServerMembers = (id: string, status: MemberStatus, query = '') =>
  useInfiniteQuery({
    queryKey: [...qk.serverMembers(id, status), query],
    queryFn: ({ pageParam }) => serversApi.listMembers(id, status, query, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length < 50 ? undefined : all.length * 50),
    enabled: !!id,
  });

function useMemberMutation<V>(id: string, fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // ['servers'] covers detail, members, stats and audit (all under ['servers', id]).
    onSuccess: () => invalidateServerData(qc, id),
  });
}

export const useReviewMembership = (id: string) =>
  useMemberMutation(id, (v: { userId: string; approve: boolean }) => serversApi.reviewMembership(id, v.userId, v.approve));
export const useSetRole = (id: string) =>
  useMemberMutation(id, (v: { userId: string; role: MemberRole }) => serversApi.setRole(id, v.userId, v.role));
export const useBanMember = (id: string) =>
  useMemberMutation(id, (v: { userId: string; reason: string | null }) => serversApi.ban(id, v.userId, v.reason));
export const useUnbanMember = (id: string) => useMemberMutation(id, (userId: string) => serversApi.unban(id, userId));
export const useRemoveMember = (id: string) => useMemberMutation(id, (userId: string) => serversApi.remove(id, userId));
export const useGrantBadge = (id: string) =>
  useMemberMutation(id, (v: { userId: string; kind: BadgeKind; label: string; expiresAt: string | null }) =>
    serversApi.grantBadge(id, v.userId, v.kind, v.label, v.expiresAt));
export const useRevokeBadge = (id: string) =>
  useMemberMutation(id, (v: { badgeId: string; reason: string | null }) => serversApi.revokeBadge(v.badgeId, v.reason));

export const useServerStats = (id: string) => useQuery({ queryKey: qk.serverStats(id), queryFn: () => serversApi.stats(id), enabled: !!id });
export const useAuditLog = (id: string) => useQuery({ queryKey: qk.serverAudit(id), queryFn: () => serversApi.auditLog(id), enabled: !!id });

export const useReports = (serverId: string | null, status: ReportStatus | null) =>
  useQuery({ queryKey: [...qk.serverReports(serverId), status], queryFn: () => serversApi.reports(serverId, status) });

export function useReviewReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { reportId: string; status: ReportStatus; note: string | null }) => serversApi.reviewReport(v.reportId, v.status, v.note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
}

export const useAnnouncements = (id: string) =>
  useQuery({ queryKey: qk.announcements(id), queryFn: () => serversApi.announcements(id), enabled: !!id });

export const useServerMessages = (id: string) => useInfiniteQuery({
  queryKey: qk.serverMessages(id),
  queryFn: ({ pageParam }) => serversApi.messages(id, pageParam),
  initialPageParam: undefined as { created_at: string; id: string } | undefined,
  getNextPageParam: (last) => last.length < 40 ? undefined : {
    created_at: last[last.length - 1].created_at, id: last[last.length - 1].id,
  },
  enabled: !!id,
});

export function usePostAnnouncement(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { title: string; body: string }) => serversApi.postAnnouncement(id, v.title, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.announcements(id) }),
  });
}

export function usePostServerMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: ServerMessageFields) => serversApi.postServerMessage(id, fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.announcements(id) });
      qc.invalidateQueries({ queryKey: qk.serverMessages(id) });
    },
  });
}

export function useSetOfficial(id: string) {
  const invalidate = useInvalidateServers();
  return useMutation({ mutationFn: (v: boolean) => serversApi.setOfficial(id, v), onSuccess: () => invalidate(id) });
}

export const useRecordVisit = () => useMutation({ mutationFn: (id: string) => serversApi.recordVisit(id) });

export function useUploadServerAvatar(id: string) {
  const invalidate = useInvalidateServers();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { uri: string; previous: string | null; onProgress?: (f: number) => void }) =>
      serversApi.uploadAvatar(id, v.uri, v.previous, v.onProgress),
    onSuccess: () => {
      invalidate(id);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useRemoveServerAvatar(id: string) {
  const invalidate = useInvalidateServers();
  return useMutation({ mutationFn: (path: string) => serversApi.removeAvatar(id, path), onSuccess: () => invalidate(id) });
}
