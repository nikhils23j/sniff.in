// Shared helpers for Sniff.in Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Client-facing error: stable code, no internals, no secrets. */
export function fail(code: string, status = 400): Response {
  return json({ error: code }, status);
}

export function env(name: string, required = true): string {
  const v = Deno.env.get(name) ?? '';
  if (required && !v) throw new Error(`missing_env_${name}`);
  return v;
}

/** Client acting AS the calling user: every query is subject to RLS / RPC checks. */
export function userClient(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Privileged client. Never return its raw query results to callers without filtering. */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request): Promise<{ id: string; client: SupabaseClient } | null> {
  const client = userClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, client };
}

/** Structured log line without PII: pass ids/codes only. */
export function log(event: string, meta: Record<string, string | number | boolean | null> = {}) {
  console.log(JSON.stringify({ event, ...meta, at: new Date().toISOString() }));
}
