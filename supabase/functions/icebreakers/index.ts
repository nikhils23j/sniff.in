// POST { connection_id } → { suggestions: string[], source: 'ai' | 'template' }
// Authorization: the shared context comes from public.get_icebreaker_context() called AS the user,
// which verifies the caller is a participant of an active connection and returns only non-private,
// shared fields. AI is used only if BOTH users consented (ai_features_consent) and a provider is configured.
import { templateIcebreakers, type IcebreakerContext } from '../_shared/icebreaker-templates.ts';
import { liveCricketOpener } from '../_shared/current-cricket.ts';
import { currentTopic, type CurrentTopic } from '../_shared/current-topics.ts';
import { textGenerator } from '../_shared/ai.ts';
import { corsHeaders, fail, json, log, requireUser, serviceClient } from '../_shared/http.ts';

const SCHEMA = {
  type: 'object',
  properties: { suggestions: { type: 'array', items: { type: 'string' } } },
  required: ['suggestions'],
  additionalProperties: false,
};

const SYSTEM = `You write conversation openers for Sniff.in, an app where two people who are physically in the same place
(a campus, office, event, train) have just mutually agreed to connect.
Rules:
- Write exactly 3 short openers (max 140 characters each), warm, natural and specific, like a friendly person would say.
- Use ONLY the facts provided. Never invent facts, places, names, opinions or events.
- Never assume what happens at the place where you met (talks, music, food, games) unless a fact states it; the place is only shared context.
- Prefer openers built on shared interests or their current intent over the place name.
- Never mention private attributes (gender, age, location, appearance) or that you are an AI.
- Every line must be a complete message the sender can send with one tap. Ask one specific question that invites a reply.
- Never give instructions such as "ask them", "tell them", "say hi", or "you should". Never claim to know live news, scores, or events.`;

const instructional = /\b(ask (them|what|about)|tell them|say hi|you(?:'re| are) both|you should)\b/i;
const sendable = (s: string) => s.length > 0 && s.length <= 200 && !instructional.test(s);

async function currentCricketOpener(admin: ReturnType<typeof serviceClient>): Promise<{ message: string; asOf: string } | null> {
  const key = Deno.env.get('CRICKETDATA_API_KEY');
  if (!key) return null;
  const { data: cached } = await admin.from('icebreaker_cricket_cache').select('fetched_at,matches').eq('id', true).maybeSingle();
  const now = Date.now();
  if (cached && now - Date.parse(cached.fetched_at) < 20 * 60_000) {
    const message = liveCricketOpener(cached.matches, new Date(now));
    return message ? { message, asOf: cached.fetched_at } : null;
  }
  try {
    const url = new URL('https://api.cricapi.com/v1/currentMatches');
    url.searchParams.set('apikey', key);
    url.searchParams.set('offset', '0');
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw new Error(`cricket_http_${response.status}`);
    const body = await response.json() as { status?: string; data?: unknown };
    if (body.status !== 'success' || !Array.isArray(body.data)) throw new Error('cricket_invalid_response');
    const asOf = new Date(now).toISOString();
    await admin.from('icebreaker_cricket_cache').upsert({ id: true, fetched_at: asOf, matches: body.data });
    const message = liveCricketOpener(body.data, new Date(now));
    return message ? { message, asOf } : null;
  } catch (error) {
    log('icebreaker_cricket_unavailable', { reason: String((error as Error).message).slice(0, 50) });
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 405);

  const user = await requireUser(req);
  if (!user) return fail('not_authenticated', 401);

  let connectionId: string;
  try {
    connectionId = String((await req.json()).connection_id ?? '');
    if (!/^[0-9a-f-]{36}$/.test(connectionId)) return fail('invalid_request');
  } catch {
    return fail('invalid_request');
  }

  // Authorised, minimised context (raises not_found if the caller isn't a participant).
  const { data: ctx, error } = await user.client.rpc('get_icebreaker_context', { p_connection_id: connectionId });
  if (error || !ctx) return fail('not_found', 404);
  const context = ctx as IcebreakerContext;

  const admin = serviceClient();
  const { data: cached } = await admin.from('icebreakers').select('suggestions, source').eq('connection_id', connectionId).maybeSingle();
  const cachedGood = cached && Array.isArray(cached.suggestions) && cached.suggestions.every((s) => sendable(String(s)));
  // Live match data is optional. Only shared cricket interest activates it; a stale or missing feed is never guessed.
  const hasCricket = context.shared_tags.some((t) => /\bcricket\b/i.test(t.name));
  const live = hasCricket ? await currentCricketOpener(admin) : null;
  const { data: flag } = await admin.from('feature_flags').select('enabled').eq('key', 'ai_icebreakers').maybeSingle();
  const topic = context.shared_tags.find((t) => /\bcricket\b/i.test(t.name))?.name ??
    context.shared_tags.find((t) => t.kind === 'interest' || t.kind === 'hobby')?.name;
  const liveTopic: CurrentTopic | null = live ? {
    suggestion: live.message, source_url: 'https://cricketdata.org/cricket-data-formats/matches',
    source_title: 'CricketData current matches', as_of: live.asOf,
  } : null;
  const currentPromise: Promise<CurrentTopic | null> = liveTopic ? Promise.resolve(liveTopic) : topic && flag?.enabled && context.ai_allowed
    ? currentTopic(admin, user.id, topic).catch(() => null) : Promise.resolve(null);
  const withCurrent = (suggestions: string[], current: CurrentTopic | null) => current
    ? [current.suggestion, ...suggestions.filter((s) => s !== current.suggestion)].slice(0, 3) : suggestions;
  if (cachedGood) {
    const current = await currentPromise;
    return json({ ...cached, suggestions: withCurrent(cached.suggestions, current), ...(current ? { current } : {}) });
  }

  const generator = textGenerator();
  let suggestions: string[] | null = null;
  let source: 'ai' | 'template' = 'template';
  // Why AI wasn't used (safe, non-secret codes) — returned for observability.
  let aiStatus = !generator ? 'not_configured' : !flag?.enabled ? 'disabled' : !context.ai_allowed ? 'no_consent' : 'pending';

  if (generator && flag?.enabled && context.ai_allowed) {
    // Per-user rate limit for paid AI calls (cached per connection, so this bounds new connections only).
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from('rate_limit_events').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('action', 'ai_icebreaker').gt('created_at', since);
    if ((count ?? 0) >= 20) aiStatus = 'rate_limited';
    if ((count ?? 0) < 20) {
      await admin.from('rate_limit_events').insert({ user_id: user.id, action: 'ai_icebreaker' });
      try {
        const facts = {
          their_first_name: context.other_name,
          shared_interests: context.shared_tags.map((t) => `${t.name} (${t.kind})`),
          same_university: context.same_university,
          their_current_intent: context.their_craving,
          their_occupation: context.their_occupation,
          where_you_met: context.server_name,
        };
        const out = await generator.generateJson<{ suggestions: string[] }>({
          name: 'icebreakers',
          system: SYSTEM,
          prompt: `Facts (JSON):\n${JSON.stringify(facts)}\n\nWrite the 3 openers.`,
          schema: SCHEMA,
          maxTokens: 1500,
        });
        const clean = (out.suggestions ?? []).map((s) => String(s).trim()).filter(sendable).slice(0, 3);
        if (clean.length) {
          suggestions = clean;
          source = 'ai';
          aiStatus = 'ok';
        } else {
          aiStatus = 'empty';
        }
      } catch (e) {
        aiStatus = `failed:${String((e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message).slice(0, 40)}`;
        log('icebreaker_ai_failed', { reason: aiStatus });
      }
    }
  }

  if (!suggestions) suggestions = templateIcebreakers(context);
  await admin.from('icebreakers').upsert({ connection_id: connectionId, suggestions, source, model: source === 'ai' ? generator?.model ?? null : null });
  const current = await currentPromise;
  log('icebreaker_served', { source, ai_status: aiStatus });
  return json({ suggestions: withCurrent(suggestions, current), source, ai_status: aiStatus, ...(current ? { current } : {}) });
});
