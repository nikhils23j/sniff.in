import type { Message } from '@/types/domain';

/**
 * Newest-first list: server messages + local unsent (pending/failed) messages that the server hasn't
 * confirmed yet. Confirmation is by client_id, the same idempotency key the database enforces.
 */
export function mergeWithOutbox(server: Message[], outbox: Message[]): Message[] {
  if (!outbox.length) return server;
  const confirmed = new Set(server.map((m) => m.client_id));
  const local = outbox.filter((m) => !confirmed.has(m.client_id));
  if (!local.length) return server;
  return [...local, ...server].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
