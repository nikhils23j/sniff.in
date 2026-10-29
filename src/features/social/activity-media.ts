import { useMutation } from '@tanstack/react-query';

import { activityApi } from './api';

/** Uploads a post photo to activity-media/<server>/… and resolves with its storage path. */
export function useUploadPostImage() {
  return useMutation({
    mutationFn: (v: { serverId: string; uri: string; onProgress?: (fraction: number) => void }) =>
      activityApi.uploadImage(v.serverId, v.uri, v.onProgress),
  });
}
