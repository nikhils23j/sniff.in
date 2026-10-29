// POST { action: 'start', email, kind: 'college'|'employer', org_name? }  → { verification_id, org_name, suggestion? }
// POST { action: 'confirm', verification_id, code }                        → { verified: true, affiliation }
//
// Proves the user controls an address at an institution/company domain by emailing a 6-digit code.
// Domain checks (authoritative, no AI):
//   - not a free/disposable mail provider (public.free_email_domains)
//   - the domain has MX records (real DNS lookup)
//   - colleges: the domain (or a parent domain) is in the university registry (public.org_domains), or uses an
//     academic suffix (.edu, .ac.in, .edu.in, .ac.uk …)
// AI (OpenAI) is only used to *suggest* a display name for unknown employer domains; it never decides validity.
// The raw code is never stored (SHA-256 with a server secret), expires in 15 minutes, max 5 attempts.
import nodemailer from 'npm:nodemailer@6.9.16';

import { textGenerator } from '../_shared/ai.ts';
import { corsHeaders, env, fail, json, log, requireUser, serviceClient } from '../_shared/http.ts';

const ACADEMIC = /\.(edu|edu\.[a-z]{2}|ac\.[a-z]{2}|ac\.in|edu\.in|res\.in)$/;
const CODE_TTL_MIN = 15;

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parentDomains(domain: string): string[] {
  const parts = domain.split('.');
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join('.'));
  return out; // cse.iitk.ac.in → [cse.iitk.ac.in, iitk.ac.in, ac.in]
}

async function hasMx(domain: string): Promise<boolean> {
  try {
    const records = await Deno.resolveDns(domain, 'MX');
    return records.length > 0;
  } catch {
    return false;
  }
}

async function sendCode(to: string, code: string, orgName: string) {
  const user = env('SMTP_USER');
  const transporter = nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOST') || 'smtp.gmail.com',
    port: Number(Deno.env.get('SMTP_PORT') || 465),
    secure: Number(Deno.env.get('SMTP_PORT') || 465) === 465,
    auth: { user, pass: env('SMTP_PASS') },
  });
  await transporter.sendMail({
    from: `"Sniff.in" <${Deno.env.get('SMTP_FROM') || user}>`,
    to,
    subject: `Your Sniff.in verification code: ${code}`,
    text: `Your code to verify your ${orgName} email on Sniff.in is ${code}. It expires in ${CODE_TTL_MIN} minutes.\n\nIf you didn't request this, ignore this email.`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1B1A22">
      <h2 style="color:#3A2E80;margin:0 0 16px">sniff.in</h2>
      <p>Your code to verify your <b>${orgName.replace(/[<>&]/g, '')}</b> email:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#3A2E80">${code}</p>
      <p style="color:#5E5B6B">It expires in ${CODE_TTL_MIN} minutes. If you didn't request this, ignore this email.</p></div>`,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 405);
  const user = await requireUser(req);
  if (!user) return fail('not_authenticated', 401);
  const admin = serviceClient();
  const body = await req.json().catch(() => ({})) as Record<string, string>;
  const secret = Deno.env.get('SNIFFIN_INTERNAL_SECRET') || Deno.env.get('PUSH_WEBHOOK_SECRET') || '';

  if (body.action === 'start') {
    if (!Deno.env.get('SMTP_PASS')) return fail('email_not_configured', 503);
    const email = String(body.email ?? '').trim().toLowerCase();
    const kind = body.kind === 'employer' ? 'employer' : 'college';
    if (!/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || email.length > 254) return fail('invalid_email');
    const domain = email.split('@')[1];

    const { data: free } = await admin.from('free_email_domains').select('domain').eq('domain', domain).maybeSingle();
    if (free) return fail('personal_email_not_allowed');
    if (!(await hasMx(domain))) return fail('domain_cannot_receive_email');

    const { data: registry } = await admin.from('org_domains').select('domain, org_name, kind')
      .in('domain', parentDomains(domain)).order('domain', { ascending: false });
    const match = (registry ?? []).sort((a, b) => b.domain.length - a.domain.length)[0];
    if (kind === 'college' && !match && !ACADEMIC.test(domain)) return fail('not_an_academic_domain');

    let orgName = match?.org_name ?? String(body.org_name ?? '').trim();
    let suggestion: string | null = null;
    if (!match) {
      // AI assistant only: suggest a readable organisation name for the domain (user can edit it).
      const gen = textGenerator();
      if (gen) {
        try {
          const out = await gen.generateJson<{ name: string; confident: boolean }>({
            name: 'org_name',
            system: 'Given an email domain, return the most likely organisation name. If unsure, return the domain\'s main label in title case and confident=false. Never invent a well-known brand unless the domain clearly is that brand.',
            prompt: `Domain: ${domain}`,
            schema: { type: 'object', properties: { name: { type: 'string' }, confident: { type: 'boolean' } }, required: ['name', 'confident'], additionalProperties: false },
            maxTokens: 400,
          });
          suggestion = out.name?.slice(0, 120) || null;
        } catch {
          suggestion = null;
        }
      }
      orgName = orgName || suggestion || domain;
    }
    if (orgName.length < 2 || orgName.length > 200) return fail('invalid_org_name');

    // Uniform 6-digit code (rejection sampling avoids modulo bias).
    let n = 0;
    do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= 4_294_000_000);
    const code = String(n % 1_000_000).padStart(6, '0');
    const nonce = crypto.randomUUID();
    // Atomic, rate-limited insert (per user 5/day, per mailbox 3/day), serialised per user in SQL.
    const { data: id, error } = await admin.rpc('affiliation_begin', {
      p_user: user.id, p_email: email, p_domain: match?.domain ?? domain, p_kind: match?.kind ?? kind, p_org_name: orgName,
      // Stored as "<nonce>$<sha256(nonce:code:secret)>" — the code itself is never stored.
      p_code_hash: `${nonce}$${await sha256(`${nonce}:${code}:${secret}`)}`, p_ttl_minutes: CODE_TTL_MIN,
    });
    if (error) return fail(/rate_limited/.test(error.message) ? 'rate_limited' : 'start_failed', /rate_limited/.test(error.message) ? 429 : 500);
    try {
      await sendCode(email, code, orgName);
    } catch (e) {
      log('affiliation_email_failed', { reason: String((e as Error).message).slice(0, 80) });
      await admin.from('affiliation_verifications').update({ status: 'failed' }).eq('id', id);
      return fail('email_send_failed', 502);
    }
    log('affiliation_started', { kind, registry: !!match });
    return json({ verification_id: id, org_name: orgName, registry_match: !!match, suggestion });
  }

  if (body.action === 'confirm') {
    const id = String(body.verification_id ?? '');
    const code = String(body.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) return fail('wrong_code');
    // Atomically consume one attempt (max 5, pending, unexpired) — parallel guesses can't bypass the limit.
    const { data: rows, error: claimErr } = await admin.rpc('affiliation_consume_attempt', { p_id: id, p_user: user.id });
    if (claimErr) return fail('confirm_failed', 500);
    const v = (rows as { code_hash: string; email: string; domain: string; kind: string; org_name: string }[] | null)?.[0];
    if (!v) {
      const { data: row } = await admin.from('affiliation_verifications').select('status, attempts, expires_at').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!row) return fail('not_found', 404);
      if (row.status === 'pending' && new Date(row.expires_at).getTime() < Date.now()) return fail('code_expired');
      if (row.attempts >= 5) return fail('too_many_attempts', 429);
      return fail('not_found', 404);
    }
    const [nonce, hash] = v.code_hash.split('$');
    if (!nonce || !hash || (await sha256(`${nonce}:${code}:${secret}`)) !== hash) return fail('wrong_code');

    // One mailbox can back only one account.
    const emailHash = await sha256(`mailbox:${v.email.toLowerCase()}`);
    const { data: taken } = await admin.from('verified_affiliations').select('user_id').eq('email_hash', emailHash).maybeSingle();
    if (taken && taken.user_id !== user.id) return fail('mailbox_already_used', 409);

    // Name provenance is re-derived from the registry, never trusted from the client.
    const { data: reg } = await admin.from('org_domains').select('org_name').eq('domain', v.domain).maybeSingle();
    await admin.from('affiliation_verifications').update({ status: 'verified', verified_at: new Date().toISOString() }).eq('id', id);
    const { data: aff, error } = await admin.from('verified_affiliations').upsert({
      user_id: user.id, kind: v.kind, org_name: reg?.org_name ?? v.org_name, org_name_source: reg ? 'registry' : 'self',
      domain: v.domain, email_hash: emailHash, verified_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
    }, { onConflict: 'user_id,domain' }).select('id, kind, org_name, org_name_source, domain, verified_at').single();
    if (error) return fail('confirm_failed', 500);
    log('affiliation_verified', { kind: v.kind, registry: !!reg });
    return json({ verified: true, affiliation: aff });
  }

  return fail('invalid_action');
});
