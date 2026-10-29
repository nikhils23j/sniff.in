// POST → (re)computes the caller's profile embedding for semantic matching.
// Runs only if: the caller consented (user_settings.ai_features_consent), the `semantic_matching` flag is on,
// and an embeddings provider is configured. Uses ONLY fields the caller exposes at 'members' level.
// Vectors are never returned to any client; they're read only inside public.discover_people().
import { embedder, EMBEDDING_DIMS } from '../_shared/ai.ts';
import { corsHeaders, fail, json, log, requireUser, serviceClient } from '../_shared/http.ts';

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 405);
  const user = await requireUser(req);
  if (!user) return fail('not_authenticated', 401);

  const admin = serviceClient();
  const [{ data: flag }, { data: settings }, { data: profile }, { data: tags }] = await Promise.all([
    admin.from('feature_flags').select('enabled').eq('key', 'semantic_matching').maybeSingle(),
    admin.from('user_settings').select('*').eq('user_id', user.id).single(),
    admin.from('profiles').select('bio, university, occupation, career_goals').eq('id', user.id).single(),
    admin.from('profile_tags').select('tags(kind, name)').eq('user_id', user.id),
  ]);

  if (!settings?.ai_features_consent) {
    // Consent withdrawn → delete any stored vectors.
    await admin.from('profile_embeddings').delete().eq('user_id', user.id);
    await admin.from('presence').update({ talk_embedding: null }).eq('user_id', user.id);
    return json({ status: 'no_consent' });
  }
  const provider = embedder();
  if (!flag?.enabled || !provider) return json({ status: 'not_configured' });

  const parts: string[] = [];
  if (settings.bio_visibility === 'members' && profile?.bio) parts.push(`About: ${profile.bio}`);
  if (settings.occupation_visibility === 'members' && profile?.occupation) parts.push(`Work: ${profile.occupation}`);
  if (settings.education_visibility === 'members' && profile?.university) parts.push(`Education: ${profile.university}`);
  if (settings.career_goals_visibility === 'members' && profile?.career_goals) parts.push(`Goals: ${profile.career_goals}`);
  if (settings.tags_visibility === 'members' && tags?.length) {
    const byKind: Record<string, string[]> = {};
    for (const row of tags as unknown as { tags: { kind: string; name: string } }[]) {
      (byKind[row.tags.kind] ??= []).push(row.tags.name);
    }
    for (const [k, names] of Object.entries(byKind)) parts.push(`${k}: ${names.join(', ')}`);
  }
  // Open to Talk topic → its own vector (used by talk_matches when both people consented).
  const { data: presence } = await admin.from('presence').select('talk_topic, talk_embedding').eq('user_id', user.id).maybeSingle();
  let topicStatus = 'none';
  if (presence?.talk_topic && !presence.talk_embedding) {
    try {
      const [tv] = await provider.embed([presence.talk_topic.slice(0, 500)]);
      if (tv.length === EMBEDDING_DIMS) {
        await admin.from('presence').update({ talk_embedding: JSON.stringify(tv) }).eq('user_id', user.id);
        topicStatus = 'updated';
      }
    } catch {
      topicStatus = 'failed';
    }
  }
  if (!parts.length) return json({ status: 'empty_profile', topic: topicStatus });

  const text = parts.join('\n').slice(0, 4000);
  const hash = await sha256(`${provider.model}:${text}`);
  const { data: existing } = await admin.from('profile_embeddings').select('content_hash').eq('user_id', user.id).maybeSingle();
  if (existing?.content_hash === hash) return json({ status: 'unchanged' });

  try {
    const [vec] = await provider.embed([text]);
    if (vec.length !== EMBEDDING_DIMS) throw new Error('bad_dimensions');
    await admin.from('profile_embeddings').upsert({
      user_id: user.id, embedding: JSON.stringify(vec), model: provider.model, content_hash: hash, updated_at: new Date().toISOString(),
    });
    log('embedding_updated', { model: provider.model });
    return json({ status: 'updated' });
  } catch (e) {
    log('embedding_failed', { reason: String((e as Error).message).slice(0, 60) });
    return fail('embedding_failed', 502);
  }
});
