import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';

import { qk } from '@/lib/query-client';

import { chatApi } from './api';

/** Hide a conversation from MY list only. It reappears if the other person messages again. */
export function useHideConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => chatApi.hide(conversationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.conversations }),
  });
}

/** "5m", "3h", "2d" style relative time for dense lists. */
export function compactAgo(iso: string): string {
  const d = new Date(iso);
  if (Date.now() - d.getTime() < 60_000) return 'now';
  return formatDistanceToNowStrict(d)
    .replace(/ seconds?/, 's')
    .replace(/ minutes?/, 'm')
    .replace(/ hours?/, 'h')
    .replace(/ days?/, 'd')
    .replace(/ months?/, 'mo')
    .replace(/ years?/, 'y');
}

/** "in 3 hours" / "2 days ago". */
export function relativeTime(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}
