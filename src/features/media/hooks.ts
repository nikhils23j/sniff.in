import { useQuery } from '@tanstack/react-query';

import { signedUrl, thumbnailPath, type Bucket } from '@/lib/upload';

/** Per-viewer signed URL for any private bucket object (authorised by Storage RLS). null → not visible. */
export function useSignedUrl(bucket: Bucket, path: string | null | undefined) {
  return useQuery({
    queryKey: ['signed-url', bucket, path ?? ''],
    queryFn: () => signedUrl(bucket, path!),
    enabled: !!path,
    staleTime: 8 * 60_000,
    gcTime: 9 * 60_000,
  });
}

/** Legacy images without a companion thumbnail fall back to the full image. */
export function useThumbnailUrl(bucket: Bucket, path: string | null | undefined) {
  return useQuery({
    queryKey: ['thumbnail-url', bucket, path ?? ''],
    queryFn: async () => {
      const thumb = thumbnailPath(path!);
      return (thumb ? await signedUrl(bucket, thumb, 600) : null) ?? signedUrl(bucket, path!, 600);
    },
    enabled: !!path,
    staleTime: 8 * 60_000,
    gcTime: 9 * 60_000,
  });
}
