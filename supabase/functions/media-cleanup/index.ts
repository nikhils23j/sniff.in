// Internal worker (called by the database via pg_net with x-webhook-secret): removes files whose messages/posts
// were deleted (ephemeral expiry, removed connections, account deletion) through the Storage API.
import { fail, json, log, serviceClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return fail('forbidden', 403);
  const admin = serviceClient();
  const { data: batch, error } = await admin.rpc('claim_storage_deletions', { p_limit: 200 });
  if (error) return fail('claim_failed', 500);
  const rows = (batch ?? []) as { id: number; bucket: string; path: string }[];
  const done: number[] = [];
  const failed: number[] = [];
  const byBucket = new Map<string, { id: number; path: string }[]>();
  for (const r of rows) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r]);
  for (const [bucket, items] of byBucket) {
    const { error: rmErr } = await admin.storage.from(bucket).remove(items.map((i) => i.path));
    if (!rmErr) { done.push(...items.map((i) => i.id)); continue; }
    // A single bad path must not hold every other object in the batch hostage.
    for (const item of items) {
      const { error: itemError } = await admin.storage.from(bucket).remove([item.path]);
      if (itemError) failed.push(item.id);
      else done.push(item.id);
    }
  }
  if (done.length) {
    const { error: completeError } = await admin.rpc('complete_storage_deletions', { p_ids: done });
    if (completeError) return fail('complete_failed', 500);
  }
  if (failed.length) {
    const { error: retryError } = await admin.rpc('fail_storage_deletions', { p_ids: failed, p_error: 'storage_remove_failed' });
    if (retryError) return fail('retry_failed', 500);
  }
  log('media_cleanup', { claimed: rows.length, removed: done.length, retry: failed.length });
  return json({ removed: done.length, retry: failed.length });
});
