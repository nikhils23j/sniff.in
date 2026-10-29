// POST { query?: string, offset?: number } → { gifs: [{ id, url, preview_url, width, height, title }] }
// Server-side GIPHY proxy (key stays on the server). Rating "pg" keeps results suitable for a social app.
// Only GIPHY media URLs are returned; the database also only accepts https://media*.giphy.com URLs.
import { corsHeaders, fail, json, requireUser, serviceClient } from '../_shared/http.ts';

type GiphyItem = {
  id: string; title: string;
  images: { fixed_height: { url: string; width: string; height: string }; fixed_height_small?: { url: string } };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 405);
  const user = await requireUser(req);
  if (!user) return fail('not_authenticated', 401);
  const key = Deno.env.get('GIPHY_API_KEY');
  if (!key) return fail('gifs_not_configured', 503);
  // Per-user quota so one account can't exhaust the shared GIPHY key (120 searches/hour).
  const admin = serviceClient();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('rate_limit_events').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('action', 'gif_search').gt('created_at', since);
  if ((count ?? 0) >= 120) return fail('rate_limited', 429);
  await admin.from('rate_limit_events').insert({ user_id: user.id, action: 'gif_search' });

  const body = await req.json().catch(() => ({})) as { query?: string; offset?: number };
  const query = String(body.query ?? '').trim().slice(0, 50);
  const offset = Math.max(0, Math.min(Number(body.offset ?? 0) || 0, 200));
  const params = new URLSearchParams({ api_key: key, limit: '24', offset: String(offset), rating: 'pg', bundle: 'messaging_non_clips' });
  if (query) params.set('q', query);
  const res = await fetch(`https://api.giphy.com/v1/gifs/${query ? 'search' : 'trending'}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return fail('gif_provider_error', 502);
  const data = (await res.json()) as { data: GiphyItem[] };
  const gifs = data.data
    .map((g) => ({
      id: g.id,
      title: g.title,
      url: g.images.fixed_height.url.split('?')[0],
      preview_url: (g.images.fixed_height_small?.url ?? g.images.fixed_height.url).split('?')[0],
      width: Number(g.images.fixed_height.width),
      height: Number(g.images.fixed_height.height),
    }))
    .filter((g) => /^https:\/\/(media[0-9]*|i)\.giphy\.com\//.test(g.url));
  return json({ gifs });
});
