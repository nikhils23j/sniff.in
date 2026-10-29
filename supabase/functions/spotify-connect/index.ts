import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'not_authenticated' }, 401);
  let accessToken: string | undefined;
  try {
    const body = await req.json();
    accessToken = typeof body?.accessToken === 'string' ? body.accessToken : undefined;
  } catch { return json({ error: 'invalid_request' }, 400); }
  if (!accessToken || accessToken.length > 4096) return json({ error: 'invalid_request' }, 400);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'not_configured' }, 503);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !userData.user) return json({ error: 'not_authenticated' }, 401);

  let spotify: { account_id?: unknown; id?: unknown; display_name?: unknown; external_urls?: { spotify?: unknown } };
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return json({ error: response.status === 429 ? 'spotify_busy' : 'spotify_auth_failed' }, response.status === 429 ? 429 : 401);
    spotify = await response.json();
  } catch { return json({ error: 'spotify_unavailable' }, 503); }
  const accountId = typeof spotify.account_id === 'string' ? spotify.account_id : '';
  const profileUrl = typeof spotify.external_urls?.spotify === 'string' ? spotify.external_urls.spotify : '';
  const displayName = typeof spotify.display_name === 'string' ? spotify.display_name : null;
  if (!accountId || accountId.length > 128 || !/^https:\/\/open\.spotify\.com\/user\/[^\s]+$/.test(profileUrl)) {
    return json({ error: 'spotify_profile_unavailable' }, 422);
  }

  const { error } = await admin.rpc('save_spotify_connection', {
    p_user_id: userData.user.id, p_account_id: accountId,
    p_profile_url: profileUrl, p_display_name: displayName?.slice(0, 200) ?? null,
  });
  if (error) return json({ error: error.code === '23505' ? 'spotify_already_connected' : 'save_failed' }, error.code === '23505' ? 409 : 500);
  return json({ profileUrl });
});
