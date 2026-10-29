import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { useUserId } from '@/features/auth/session-store';
import { registerAccountCleaner } from '@/lib/account-state';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { qk } from '@/lib/query-client';
import { rpc } from '@/lib/rpc';
import { DOCUMENT_TYPES, IMAGE_TYPES, MAX_FILE_BYTES } from '@/lib/upload';
import type { Message, MessageKind, Tag } from '@/types/domain';

import { chatApi } from './api';
import { newClientId, useOutbox } from './hooks';

type MessagePages = InfiniteData<Message[], string | undefined>;
type RichKind = Exclude<MessageKind, 'text'>;
type RichFields = Parameters<typeof chatApi.sendRich>[3];
type UploadedFields = Awaited<ReturnType<typeof chatApi.uploadAttachment>>;

export type PickedFile = { uri: string; name?: string | null; mime?: string | null; size?: number | null; isImage: boolean };

const GIF_URL = /^https:\/\/(media[0-9]*|i)\.giphy\.com\//;
const STICKER_ID = /^[a-z0-9_-]{1,40}$/;

/** Same de-duplicating insert that the realtime handler and useSendMessage use (not exported from hooks.ts). */
function upsertMessage(data: MessagePages | undefined, msg: Message): MessagePages | undefined {
  if (!data) return data;
  const pages = data.pages.map((p) => p.filter((m) => m.id !== msg.id && m.client_id !== msg.client_id));
  pages[0] = [msg, ...(pages[0] ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { ...data, pages };
}

/** Friendly pre-upload validation. Throws AppError (use toast.error) before any optimistic entry is created. */
export function validateAttachment(file: PickedFile): void {
  if (file.size != null && file.size > MAX_FILE_BYTES) {
    throw new AppError('file_too_large', 'That file is over 20 MB. Choose a smaller one.');
  }
  if (file.isImage) {
    const mime = (file.mime ?? '').toLowerCase();
    if (mime && !IMAGE_TYPES.includes(mime)) throw new AppError('unsupported_file', 'Send a JPG, PNG, WebP, HEIC or GIF image.');
    return;
  }
  const mime = (file.mime ?? '').toLowerCase();
  if (!DOCUMENT_TYPES.includes(mime)) {
    throw new AppError('unsupported_file', 'Send PDFs, Word, Excel, PowerPoint or text files.');
  }
}

/** In-memory retry state per client id. The uploaded media path is kept so a retry never re-uploads. */
type Job = {
  conversationId: string;
  base: Message;
  file?: PickedFile;
  uploaded?: UploadedFields;
  fields?: RichFields;
};
const jobs = new Map<string, Job>();
registerAccountCleaner(() => jobs.clear());

function useRichSender(conversationId: string) {
  const qc = useQueryClient();
  const uid = useUserId() ?? '';

  const run = useCallback(async (clientId: string) => {
    const job = jobs.get(clientId);
    if (!job) return;
    const outbox = useOutbox.getState();
    const mark = (patch: Partial<Message>) => outbox.put({ ...job.base, ...patch });
    mark({ pending: true, failed: false, upload_progress: job.uploaded || !job.file ? undefined : 0 });
    try {
      if (job.file && !job.uploaded) {
        let last = 0;
        job.uploaded = await chatApi.uploadAttachment(
          conversationId,
          { uri: job.file.uri, name: job.file.name, mime: job.file.mime, isImage: job.file.isImage },
          (f) => {
            if (f - last >= 0.02 || f >= 1) {
              last = f;
              mark({ pending: true, failed: false, upload_progress: f });
            }
          },
        );
      }
      const fields = job.fields ?? job.uploaded;
      if (!fields) throw new AppError('unknown', 'Something went wrong. Please try again.');
      mark({ pending: true, failed: false, upload_progress: undefined });
      const msg = await chatApi.sendRich(conversationId, uid, clientId, fields);
      qc.setQueryData<MessagePages>(qk.messages(conversationId), (d) => upsertMessage(d, msg));
      outbox.remove(conversationId, clientId);
      jobs.delete(clientId);
      qc.invalidateQueries({ queryKey: qk.conversations });
    } catch (e) {
      logger.warn('rich_send_failed', { kind: job.base.kind });
      mark({ pending: false, failed: true, upload_progress: undefined });
      throw e;
    }
  }, [conversationId, qc, uid]);

  const enqueue = useCallback((kind: RichKind, init: { fields?: RichFields; file?: PickedFile; preview: Partial<Message> }) => {
    const clientId = newClientId();
    const base: Message = {
      id: `local-${clientId}`, conversation_id: conversationId, sender_id: uid, client_id: clientId, body: null, kind,
      created_at: new Date().toISOString(), pending: true, ...init.preview,
    };
    jobs.set(clientId, { conversationId, base, file: init.file, fields: init.fields });
    return run(clientId);
  }, [conversationId, run, uid]);

  const retry = useCallback((clientId: string) => run(clientId), [run]);
  const discard = useCallback((clientId: string) => {
    const job = jobs.get(clientId);
    jobs.delete(clientId);
    useOutbox.getState().remove(conversationId, clientId);
    // An upload that succeeded but was never sent would otherwise be orphaned in Storage.
    const orphan = job?.uploaded?.media_path;
    if (orphan) supabase.storage.from('chat-media').remove([orphan]).catch(() => {});
  }, [conversationId]);

  return { enqueue, retry, discard };
}

/** Photo (library or camera) or document: optimistic row with upload progress, then insert. */
export function useSendAttachment(conversationId: string) {
  const { enqueue, retry, discard } = useRichSender(conversationId);
  const send = useCallback((file: PickedFile) => {
    validateAttachment(file);
    return enqueue(file.isImage ? 'image' : 'file', {
      file,
      preview: {
        local_uri: file.uri, media_name: file.name ?? null, media_mime: file.mime ?? null, media_size: file.size ?? null,
        upload_progress: 0,
      },
    });
  }, [enqueue]);
  return { send, retry, discard };
}

export function useSendGif(conversationId: string) {
  const { enqueue } = useRichSender(conversationId);
  return useCallback((url: string, width?: number, height?: number) => {
    if (!GIF_URL.test(url)) throw new AppError('invalid_gif', 'That GIF can’t be sent.');
    const w = width && width > 0 ? Math.round(width) : undefined;
    const h = height && height > 0 ? Math.round(height) : undefined;
    return enqueue('gif', {
      fields: { kind: 'gif', gif_url: url, media_width: w, media_height: h },
      preview: { gif_url: url, media_width: w, media_height: h },
    });
  }, [enqueue]);
}

export function useSendSticker(conversationId: string) {
  const { enqueue } = useRichSender(conversationId);
  return useCallback((stickerId: string) => {
    if (!STICKER_ID.test(stickerId)) throw new AppError('invalid_sticker', 'That sticker can’t be sent.');
    return enqueue('sticker', { fields: { kind: 'sticker', sticker_id: stickerId }, preview: { sticker_id: stickerId } });
  }, [enqueue]);
}

export function useSendLocation(conversationId: string) {
  const { enqueue } = useRichSender(conversationId);
  return useCallback((lat: number, lng: number) => {
    // Column is numeric(8,5): ~1 m precision, which is what the user explicitly agreed to share.
    const la = Math.round(lat * 1e5) / 1e5;
    const ln = Math.round(lng * 1e5) / 1e5;
    return enqueue('location', {
      fields: { kind: 'location', location_lat: la, location_lng: ln },
      preview: { location_lat: la, location_lng: ln },
    });
  }, [enqueue]);
}

// ================================================================ common ground
export type CommonGround = {
  other_name: string | null;
  shared_tags: Pick<Tag, 'kind' | 'name'>[] | null;
  same_university: string | null;
  their_craving: string | null;
  their_occupation: string | null;
  server_name: string | null;
  ai_allowed?: boolean;
};

export const useCommonGround = (connectionId: string | undefined) =>
  useQuery({
    queryKey: ['common-ground', connectionId ?? ''],
    queryFn: () => rpc<CommonGround>('get_icebreaker_context', { p_connection_id: connectionId }),
    enabled: !!connectionId,
    staleTime: 5 * 60_000,
  });

// ================================================================ conversation starters
const dismissedKey = (conversationId: string) => `sniffin.starters.dismissed.${conversationId}`;

/** Per-conversation "hide starters" flag, persisted in AsyncStorage. `loaded` is false until it has been read. */
export function useStartersDismissed(conversationId: string) {
  const [state, setState] = useState<{ id: string; dismissed: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(dismissedKey(conversationId))
      .then((v) => live && setState({ id: conversationId, dismissed: v === '1' }))
      .catch(() => live && setState({ id: conversationId, dismissed: false }));
    return () => {
      live = false;
    };
  }, [conversationId]);
  const dismiss = useCallback(() => {
    setState({ id: conversationId, dismissed: true });
    AsyncStorage.setItem(dismissedKey(conversationId), '1').catch(() => {});
  }, [conversationId]);
  const current = state && state.id === conversationId ? state : null;
  return { loaded: !!current, dismissed: current ? current.dismissed : true, dismiss };
}

/** reset_icebreakers → refetch. Errors (e.g. rate_limited) are thrown for the caller's toast. */
export function useRefreshIcebreakers(connectionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!connectionId) return;
      await chatApi.resetIcebreakers(connectionId);
      await qc.refetchQueries({ queryKey: qk.icebreakers(connectionId) });
    },
  });
}
