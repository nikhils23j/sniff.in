// POST → permanently deletes the caller's account.
// Deleting the auth user cascades (FK ON DELETE CASCADE) through profiles, private data, settings,
// memberships, tags, cravings, requests, connections, conversations, messages they sent, posts,
// notifications, push tokens and embeddings. Reports they filed keep the report but drop the reporter id.
// Avatar files are removed from Storage first. Backups follow the Supabase project's retention window.
import { corsHeaders, fail, json, log, requireUser, serviceClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 405);

  const user = await requireUser(req);
  if (!user) return fail('not_authenticated', 401);
  const admin = serviceClient();

  // 1. Storage cleanup (best effort; the folder is namespaced by user id).
  const { data: files } = await admin.storage.from('avatars').list(user.id, { limit: 100 });
  if (files?.length) {
    await admin.storage.from('avatars').remove(files.map((f) => `${user.id}/${f.name}`));
  }

  // 2. Delete the auth user → cascades all personal rows.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    log('delete_account_failed', { code: error.name });
    return fail('delete_failed', 500);
  }
  log('account_deleted', {});
  return json({ ok: true });
});
