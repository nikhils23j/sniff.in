import { mergeWithOutbox } from '@/features/social/merge';
import type { Message } from '@/types/domain';

const msg = (client_id: string, created_at: string, extra: Partial<Message> = {}): Message => ({
  id: extra.id ?? `srv-${client_id}`, conversation_id: 'c1', sender_id: 'me', client_id, body: client_id, created_at, kind: 'text', ...extra,
});

describe('chat outbox merge', () => {
  const server = [msg('b', '2026-10-18T10:02:00Z'), msg('a', '2026-10-18T10:01:00Z')];

  it('returns server list untouched when nothing is unsent', () => {
    expect(mergeWithOutbox(server, [])).toBe(server);
  });

  it('keeps failed/pending messages across a refetch, newest first', () => {
    const failed = msg('c', '2026-10-18T10:03:00Z', { id: 'local-c', failed: true });
    const out = mergeWithOutbox(server, [failed]);
    expect(out.map((m) => m.client_id)).toEqual(['c', 'b', 'a']);
    expect(out[0].failed).toBe(true);
  });

  it('drops the local copy once the server has the same client_id (no duplicates)', () => {
    const pending = msg('b', '2026-10-18T10:02:30Z', { id: 'local-b', pending: true });
    const out = mergeWithOutbox(server, [pending]);
    expect(out).toHaveLength(2);
    expect(out.every((m) => !m.pending)).toBe(true);
  });
});
