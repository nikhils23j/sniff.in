import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';


import { env } from './env';
import { AppError } from './errors';
import { rpc } from './rpc';
import { supabase } from './supabase';

export type Bucket = 'avatars' | 'profile-photos' | 'server-avatars' | 'activity-media' | 'chat-media' | 'server-media' | 'feedback-media';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'];
export const DOCUMENT_TYPES = [
  'application/pdf', 'text/plain', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;
export const BUCKET_LIMITS: Record<Bucket, number> = {
  avatars: 5 * 1024 * 1024,
  'profile-photos': 5 * 1024 * 1024,
  'server-avatars': 5 * 1024 * 1024,
  'activity-media': 8 * 1024 * 1024,
  'chat-media': MAX_FILE_BYTES,
  'server-media': MAX_FILE_BYTES,
  'feedback-media': 5 * 1024 * 1024,
};

/**
 * Downsamples before decoding when possible, then re-encodes as JPEG to strip
 * EXIF/GPS metadata. Neither landscape nor portrait images are ever enlarged.
 */
export async function prepareImage(uri: string, maxEdge = 1600) {
  const edge = Math.min(maxEdge, 1600);
  const context = ImageManipulator.ImageManipulator.manipulate(uri, { maxWidth: edge, maxHeight: edge });
  let rendered = await context.renderAsync();
  if (rendered.width > edge || rendered.height > edge) {
    context.resize(rendered.width >= rendered.height ? { width: edge, height: null } : { width: null, height: edge });
    rendered = await context.renderAsync();
  }
  const out = await rendered.saveAsync({ compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  return { uri: out.uri, width: out.width, height: out.height, mime: 'image/jpeg' as string };
}

/**
 * Uploads a local file to Supabase Storage with progress callbacks (supabase-js has no progress events).
 * Authorization is enforced by the bucket's RLS policies on the server.
 */
export async function uploadWithProgress(opts: {
  bucket: Bucket;
  path: string;
  uri: string;
  contentType: string;
  onProgress?: (fraction: number) => void;
}): Promise<{ path: string; size: number }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppError('not_authenticated', 'Please sign in again.');
  // Native File.size reads metadata without loading a 20 MB document into JS memory.
  let blob: Blob | null = Platform.OS === 'web' ? await (await fetch(opts.uri)).blob() : null;
  const size = blob?.size ?? new File(opts.uri).size;
  if (!size) throw new AppError('invalid_file', 'That file is empty or unavailable. Choose it again.');
  if (size > BUCKET_LIMITS[opts.bucket]) {
    throw new AppError('file_too_large', `This upload must be under ${BUCKET_LIMITS[opts.bucket] / 1024 / 1024} MB.`);
  }
  await rpc<void>('reserve_media_upload', { p_bucket: opts.bucket, p_path: opts.path, p_bytes: size });

  if (size > RESUMABLE_THRESHOLD) {
    const tus = await import('tus-js-client');
    const storage = new URL(env.supabaseUrl);
    if (storage.hostname.endsWith('.supabase.co') && !storage.hostname.endsWith('.storage.supabase.co')) {
      storage.hostname = storage.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co');
    }
    const endpoint = `${storage.origin}/storage/v1/upload/resumable`;
    return new Promise((resolve, reject) => {
      const source = Platform.OS === 'web' ? blob! : { uri: opts.uri, name: opts.path.split('/').at(-1), size } as unknown as File;
      const upload = new tus.Upload(source, {
        endpoint, uploadSize: size, chunkSize: RESUMABLE_THRESHOLD,
        retryDelays: [0, 1500, 3000, 5000, 10000],
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        headers: { authorization: `Bearer ${token}`, apikey: env.supabaseAnonKey, 'x-upsert': 'false' },
        metadata: { bucketName: opts.bucket, objectName: opts.path, contentType: opts.contentType },
        onProgress: (sent, total) => opts.onProgress?.(sent / total),
        onError: () => reject(new AppError('upload_failed', 'Upload interrupted. Please retry.')),
        onSuccess: () => { opts.onProgress?.(1); resolve({ path: opts.path, size }); },
      });
      upload.start();
    });
  }

  blob ??= await (await fetch(opts.uri)).blob();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${env.supabaseUrl}/storage/v1/object/${opts.bucket}/${opts.path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', env.supabaseAnonKey);
    xhr.setRequestHeader('Content-Type', opts.contentType);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1);
        resolve({ path: opts.path, size });
      } else if (xhr.status === 413) {
        reject(new AppError('file_too_large', 'That file is too large.'));
      } else if (xhr.status === 403 || xhr.status === 401) {
        reject(new AppError('forbidden', "You can't upload here."));
      } else if (xhr.status === 415 || xhr.status === 400) {
        reject(new AppError('unsupported_file', "That file type isn't supported."));
      } else {
        reject(new AppError('upload_failed', 'Upload failed. Please try again.'));
      }
    };
    xhr.onerror = () => reject(new AppError('network', 'You seem to be offline. Check your connection and try again.'));
    xhr.send(blob);
  });
}

/** The sweeper also detects attached references if this acknowledgement is interrupted. */
export async function finalizeMediaUpload(bucket: Bucket, path: string) {
  await rpc<void>('finalize_media_upload', { p_bucket: bucket, p_path: path });
}

export function randomFileName(ext: string) {
  // Storage paths are validated server-side (≤100 chars); never let a long or missing extension break an upload.
  const clean = ext.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10);
  return `${Crypto.randomUUID()}.${clean || 'bin'}`;
}

/** New JPEG uploads use a companion object for small grid/card previews. */
export function thumbnailPath(path: string): string | null {
  return path.endsWith('.jpg') ? `${path.slice(0, -4)}-thumb.jpg` : null;
}

type SignRequest = { path: string; resolve: (url: string | null) => void };
const pendingSigns = new Map<string, SignRequest[]>();
let signTimer: ReturnType<typeof setTimeout> | null = null;

async function flushSignedUrls() {
  signTimer = null;
  const groups = [...pendingSigns];
  pendingSigns.clear();
  await Promise.all(groups.map(async ([key, requests]) => {
    const [bucket, secondsText] = key.split('|') as [Bucket, string];
    const seconds = Number(secondsText);
    const paths = [...new Set(requests.map((request) => request.path))];
    const urls = new Map<string, string | null>();
    for (let i = 0; i < paths.length; i += 50) {
      const chunk = paths.slice(i, i + 50);
      try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrls(chunk, seconds);
        if (error || !data) chunk.forEach((path) => urls.set(path, null));
        else data.forEach((item) => { if (item.path) urls.set(item.path, item.error ? null : item.signedUrl); });
      } catch { chunk.forEach((path) => urls.set(path, null)); }
    }
    requests.forEach(({ path, resolve }) => resolve(urls.get(path) ?? null));
  }));
}

/** Nearby image components share one authorized Storage signing request per bucket. */
export function signedUrl(bucket: Bucket, path: string, seconds = 600): Promise<string | null> {
  return new Promise((resolve) => {
    const key = `${bucket}|${seconds}`;
    const group = pendingSigns.get(key) ?? [];
    group.push({ path, resolve });
    pendingSigns.set(key, group);
    if (!signTimer) signTimer = setTimeout(() => void flushSignedUrls(), 15);
  });
}
