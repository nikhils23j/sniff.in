import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** Coalesces event bursts and duplicate subscribe/reconnect signals into one refetch per query. */
export function createInvalidationBatch(client: QueryClient, delayMs = 200) {
  const pending = new Map<string, { queryKey: QueryKey; exact: boolean }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    for (const entry of pending.values()) {
      void client.invalidateQueries({ queryKey: entry.queryKey, exact: entry.exact, refetchType: 'active' });
    }
    pending.clear();
  };
  return {
    add(queryKey: QueryKey, exact = false) {
      pending.set(JSON.stringify([queryKey, exact]), { queryKey, exact });
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    dispose() { if (timer) clearTimeout(timer); pending.clear(); },
  };
}
