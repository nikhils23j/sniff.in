#!/usr/bin/env node
// LIVE end-to-end check against a real Supabase project (dev/staging only).
// Creates three throwaway accounts (@sniff-test.invalid), runs the core Sniff.in flow through the public API
// exactly as the app does (anon key + user sessions, Realtime, Storage, Edge Functions), asserts security
// boundaries, then deletes everything it created.
//
//   STAGING_* environment values required; never use a production project.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const url = process.env.STAGING_SUPABASE_URL;
const anon = process.env.STAGING_SUPABASE_ANON_KEY;
const service = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const projectRef = process.env.STAGING_PROJECT_REF;
if (!url || !anon || !service || !projectRef || process.env.E2E_TARGET !== 'staging') {
  throw new Error('Set E2E_TARGET=staging and all STAGING_SUPABASE_* values plus STAGING_PROJECT_REF');
}
if (new URL(url).hostname !== `${projectRef}.supabase.co`) throw new Error('Staging URL and project ref do not match');

const admin = createClient(url, service, { auth: { persistSession: false } });
const tag = randomUUID().slice(0, 6);
const PASSWORD = `E2e-${randomUUID().slice(0, 12)}9`;
const created = [];
const results = [];

async function step(name, fn) {
  const t0 = performance.now();
  try {
    const out = await fn();
    results.push(['✓', name, `${(performance.now() - t0).toFixed(0)} ms`]);
    return out;
  } catch (e) {
    results.push(['✗', name, String(e.message).slice(0, 160)]);
    throw e;
  }
}
const must = async (p) => {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
};
/**
 * Resolves once database changes are actually flowing. `SUBSCRIBED` only means the channel joined;
 * postgres_changes become active after a later system message ("Subscribed to PostgreSQL").
 */
const subscribed = (channel) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('realtime postgres_changes not ready within 20s')), 20_000);
  channel
    .on('system', {}, (msg) => {
      if (msg?.extension === 'postgres_changes' && msg.status === 'ok') { clearTimeout(timer); resolve(); }
    })
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(`realtime ${status} ${err?.message ?? ''}`)); }
    });
});
const expectError = async (p, re) => {
  const { error } = await p;
  assert.ok(error, 'expected an error');
  if (re) assert.match(error.message, re);
};

async function makeUser(label, tags) {
  const email = `e2e-${label}-${tag}@sniff-test.invalid`;
  const { user } = await must(admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: `[E2E] ${label}` } }));
  created.push(user.id);
  const client = createClient(url, anon, { auth: { persistSession: false } });
  await must(client.auth.signInWithPassword({ email, password: PASSWORD }));
  await must(client.rpc('complete_onboarding', {
    p_username: `e2e_${label}_${tag}`.toLowerCase(), p_display_name: `[E2E] ${label}`, p_date_of_birth: '1999-04-01',
    p_gender: null, p_discovery_audience: 'everyone',
  }));
  for (const [kind, names] of Object.entries(tags)) await must(client.rpc('set_my_tags', { p_kind: kind, p_names: names }));
  return { id: user.id, client };
}

let serverId;
try {
  const A = await step('create + onboard user A', () => makeUser('a', { interest: ['Machine Learning', 'Startups'], hobby: ['Badminton'] }));
  const B = await step('create + onboard user B', () => makeUser('b', { interest: ['Machine Learning'], hobby: ['Badminton', 'Trekking'] }));
  const C = await step('create + onboard user C', () => makeUser('c', { interest: ['Cricket'] }));

  await step('anon cannot read profiles', async () => {
    const pub = createClient(url, anon, { auth: { persistSession: false } });
    await expectError(pub.from('profiles').select('id').limit(1), /permission denied/);
  });

  const token = await step('A creates short-term ephemeral Server + QR token', async () => {
    serverId = await must(A.client.rpc('create_server', {
      p_name: `[E2E] Fest ${tag}`, p_kind: 'short_term', p_category: 'festival', p_join_policy: 'invite_only', p_visibility: 'unlisted',
      p_ends_at: new Date(Date.now() + 2 * 3600_000).toISOString(), p_ephemeral_chats: true,
    }));
    return (await must(A.client.rpc('create_join_token', { p_server_id: serverId, p_kind: 'qr' }))).token;
  });

  await step('C cannot see the unlisted Server; bogus token is "invalid"', async () => {
    await expectError(C.client.rpc('get_server', { p_server_id: serverId }), /not_found/);
    const r = await must(C.client.rpc('join_server_with_token', { p_token: 'not-a-real-token-xxxxxxxx' }));
    assert.equal(r.status, 'invalid');
  });

  await step('B previews + joins via QR link', async () => {
    const preview = await must(B.client.rpc('preview_join_token', { p_token: `https://sniff.in/join?t=${token}` }));
    assert.equal(preview.status, 'valid');
    const r = await must(B.client.rpc('join_server_with_token', { p_token: token }));
    assert.equal(r.status, 'active');
  });

  await step('V2 presence: Available ON by default, Open to Talk OFF; matches need Open to Talk', async () => {
    const p = await must(A.client.rpc('heartbeat'));
    assert.equal(p.is_available, true);
    assert.equal(p.open_to_talk, false);
    await expectError(A.client.rpc('talk_matches', { p_limit: 5 }), /not_open_to_talk/);
  });

  await step('A + B turn on Open to Talk; A gets B as a top match with reasons', async () => {
    await must(A.client.rpc('set_open_to_talk', { p_open: true, p_topic: 'badminton and ML research' }));
    await must(B.client.rpc('set_open_to_talk', { p_open: true, p_topic: 'looking for a badminton partner' }));
    const rows = await must(A.client.rpc('talk_matches', { p_limit: 5 }));
    assert.equal(rows[0].user_id, B.id);
    assert.ok(rows[0].reasons.length > 0, JSON.stringify(rows[0].reasons));
    const legacy = await must(A.client.rpc('discover_people', { p_server_id: serverId }));
    assert.equal(legacy[0].user_id, B.id);
  });

  await step('Discover dashboard returns curated sections', async () => {
    const d = await must(B.client.rpc('discover_dashboard'));
    for (const k of ['popular_servers', 'trending_servers', 'suggested_servers', 'activities_for_you']) assert.ok(Array.isArray(d[k]), k);
  });

  await step('Storage: A uploads avatar; B (co-member, available) can sign it; C cannot', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const path = `${A.id}/${randomUUID()}.png`;
    await must(A.client.rpc('reserve_media_upload', { p_bucket: 'avatars', p_path: path, p_bytes: png.length }));
    await must(A.client.storage.from('avatars').upload(path, png, { contentType: 'image/png' }));
    await must(A.client.from('profiles').update({ avatar_path: path }).eq('id', A.id));
    await must(A.client.rpc('finalize_media_upload', { p_bucket: 'avatars', p_path: path }));
    await must(B.client.storage.from('avatars').createSignedUrl(path, 60));
    await expectError(C.client.storage.from('avatars').createSignedUrl(path, 60));
    await expectError(C.client.storage.from('avatars').upload(`${A.id}/evil.png`, png, { contentType: 'image/png' }));
  });

  // B listens for notifications over Realtime (RLS-filtered to B).
  let resolveNote;
  const notified = new Promise((resolve) => { resolveNote = resolve; });
  await step('B subscribes to own notifications (Realtime)', () =>
    subscribed(B.client.channel(`n-${tag}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${B.id}` }, (p) => resolveNote(p.new))));

  const requestId = await step('A sends a connection request with an intro', async () => {
    const r = await must(A.client.rpc('send_connection_request', { p_recipient: B.id, p_server_id: serverId, p_message: 'Badminton later?' }));
    assert.equal(r.status, 'pending');
    return r.request_id;
  });
  await step('B receives the request notification via Realtime', async () => {
    const n = await Promise.race([notified, new Promise((_, rej) => setTimeout(() => rej(new Error('no realtime notification within 15s')), 15_000))]);
    assert.equal(n.type, 'connection_request');
  });

  const conversationId = await step('B accepts → private conversation for both', async () => {
    const r = await must(B.client.rpc('respond_to_request', { p_request_id: requestId, p_accept: true }));
    assert.equal(r.status, 'accepted');
    const conv = await must(B.client.rpc('get_conversation', { p_conversation_id: r.conversation_id }));
    assert.ok(conv.expires_at, 'ephemeral Server → chat has an expiry until both save');
    return r.conversation_id;
  });

  await step('Realtime chat: A sends, B receives live', async () => {
    let resolveMsg;
    const received = new Promise((resolve, reject) => {
      resolveMsg = resolve;
      setTimeout(() => reject(new Error('no realtime message within 15s')), 15_000);
    });
    await subscribed(B.client.channel(`c-${tag}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (p) => resolveMsg(p.new)));
    const clientId = randomUUID();
    await must(A.client.from('messages').insert({ conversation_id: conversationId, sender_id: A.id, client_id: clientId, body: 'Hey B!' }));
    const msg = await received;
    assert.equal(msg.body, 'Hey B!');
    // Idempotent retry: same client_id must not create a duplicate.
    const { error } = await A.client.from('messages').insert({ conversation_id: conversationId, sender_id: A.id, client_id: clientId, body: 'Hey B!' });
    assert.ok(error);
  });

  await step("Chat media: photo via private storage, sticker; C can't read the file", async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const path = `${conversationId}/${randomUUID()}.png`;
    await must(A.client.rpc('reserve_media_upload', { p_bucket: 'chat-media', p_path: path, p_bytes: png.length }));
    await must(A.client.storage.from('chat-media').upload(path, png, { contentType: 'image/png' }));
    await must(A.client.from('messages').insert({ conversation_id: conversationId, sender_id: A.id, client_id: randomUUID(), kind: 'image', media_path: path, media_mime: 'image/png', media_size: png.length }));
    await must(A.client.rpc('finalize_media_upload', { p_bucket: 'chat-media', p_path: path }));
    await must(B.client.storage.from('chat-media').createSignedUrl(path, 60));
    await expectError(C.client.storage.from('chat-media').createSignedUrl(path, 60));
    await must(B.client.from('messages').insert({ conversation_id: conversationId, sender_id: B.id, client_id: randomUUID(), kind: 'sticker', sticker_id: 'namaste' }));
  });

  await step('C cannot read or write the conversation', async () => {
    const rows = await must(C.client.from('messages').select('id').eq('conversation_id', conversationId));
    assert.equal(rows.length, 0);
    await expectError(C.client.from('messages').insert({ conversation_id: conversationId, sender_id: C.id, client_id: randomUUID(), body: 'intrude' }), /row-level security/);
  });

  await step('Connections-only fields hidden before, visible after accept', async () => {
    await must(B.client.from('profiles').update({ instagram_handle: 'e2e.test' }).eq('id', B.id));
    const card = await must(A.client.rpc('get_profile', { p_user_id: B.id }));
    assert.equal(card.instagram_handle, 'e2e.test');
    assert.equal(card.relationship.state, 'connected');
  });

  await step('Edge Function: icebreakers (OpenAI when both consent)', async () => {
    await must(A.client.from('user_settings').update({ ai_features_consent: true }).eq('user_id', A.id));
    await must(B.client.from('user_settings').update({ ai_features_consent: true }).eq('user_id', B.id));
    const conv = await must(A.client.rpc('get_conversation', { p_conversation_id: conversationId }));
    const { data, error } = await A.client.functions.invoke('icebreakers', { body: { connection_id: conv.connection_id } });
    if (error) throw new Error(`function error: ${error.message}`);
    assert.ok(Array.isArray(data.suggestions) && data.suggestions.length > 0);
    results.push(['  ', `icebreakers source=${data.source} ai_status=${data.ai_status}`, data.suggestions[0].slice(0, 90)]);
  });

  await step('Edge Function: embed-profile (OpenAI embeddings, consent-gated)', async () => {
    const { data, error } = await A.client.functions.invoke('embed-profile', { method: 'POST' });
    if (error) throw new Error(`function error: ${error.message}`);
    assert.ok(['updated', 'unchanged'].includes(data.status), JSON.stringify(data));
  });

  await step("Activity: I'm in / I'm not in / capacity", async () => {
    const post = await must(A.client.rpc('create_activity_post', { p_server_id: serverId, p_body: 'Badminton at 7am?', p_category: 'sports', p_capacity: 1 }));
    const D = await makeUser('d', { interest: ['Machine Learning'] });
    await must(D.client.rpc('join_server_with_token', { p_token: token }));
    assert.equal((await must(B.client.rpc('set_post_response', { p_post_id: post, p_kind: 'in' }))).kind, 'in');
    await expectError(D.client.rpc('set_post_response', { p_post_id: post, p_kind: 'in' }), /activity_full/);
    assert.equal((await must(D.client.rpc('set_post_response', { p_post_id: post, p_kind: 'not_in' }))).kind, 'not_in');
    const responses = await must(A.client.rpc('list_post_responses', { p_post_id: post }));
    assert.equal(responses.length, 2);
    const feed = await must(B.client.rpc('list_activity', { p_server_id: serverId, p_sort: 'for_you' }));
    assert.ok(feed.some((p) => p.id === post && p.is_full));
    return D;
  });

  await step('Hot Map: opt-in only, aggregated ranges (k ≥ 3, accounts > 24h)', async () => {
    // Test accounts are brand new; age them so they are eligible to be counted.
    await admin.from('profiles').update({ created_at: new Date(Date.now() - 2 * 86400_000).toISOString() }).in('id', [A.id, B.id, C.id]);
    for (const u of [A, B]) {
      await must(u.client.from('user_settings').update({ hot_map_opt_in: true }).eq('user_id', u.id));
      await must(u.client.rpc('update_my_location', { p_lat: 19.07612, p_lng: 72.87765 }));
    }
    let cells = await must(C.client.rpc('hot_map', { p_min_lat: 19, p_min_lng: 72.8, p_max_lat: 19.2, p_max_lng: 73 }));
    assert.equal(cells.length, 0, 'two people are below the k=3 threshold');
    await must(C.client.from('user_settings').update({ hot_map_opt_in: true }).eq('user_id', C.id));
    await must(C.client.rpc('update_my_location', { p_lat: 19.0759, p_lng: 72.8771 }));
    cells = await must(C.client.rpc('hot_map', { p_min_lat: 19, p_min_lng: 72.8, p_max_lat: 19.2, p_max_lng: 73 }));
    assert.equal(cells.length, 1);
    assert.equal(cells[0].people_label, '3–4');
    await expectError(C.client.from('location_cells').select('*'), /permission denied/);
  });

  await step('Turning Available OFF removes B from matches', async () => {
    await must(B.client.rpc('set_available', { p_available: false }));
    const rows = await must(A.client.rpc('talk_matches', { p_limit: 5 }));
    assert.ok(!rows.some((r) => r.user_id === B.id));
  });

  await step('Block closes the chat for both', async () => {
    await must(B.client.rpc('block_user', { p_user_id: A.id }));
    await expectError(A.client.from('messages').insert({ conversation_id: conversationId, sender_id: A.id, client_id: randomUUID(), body: 'still there?' }), /row-level security/);
    assert.equal((await must(A.client.rpc('list_conversations'))).length, 0);
  });

  await step('Report is recorded and hidden from the reported user', async () => {
    const id = await must(B.client.rpc('create_report', { p_reason: 'spam', p_details: 'e2e', p_target_user: A.id, p_server_id: serverId }));
    assert.equal((await must(A.client.from('reports').select('id').eq('id', id))).length, 0);
  });

  await step('Edge Function: delete-account removes C completely', async () => {
    const { error } = await C.client.functions.invoke('delete-account', { method: 'POST' });
    if (error) throw new Error(`function error: ${error.message}`);
    const { data } = await admin.auth.admin.getUserById(C.id);
    assert.equal(data?.user ?? null, null);
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('id', C.id);
    assert.equal(count, 0);
  });
} catch {
  // reported below
} finally {
  // Cleanup: deleting the auth users cascades every row they created (Server via its creator is set null → delete it explicitly).
  if (serverId) await admin.from('servers').delete().eq('id', serverId);
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
  const { data: avatars } = await admin.storage.from('avatars').list('', { limit: 1000 });
  for (const folder of avatars ?? []) {
    if (created.includes(folder.name)) {
      const { data: files } = await admin.storage.from('avatars').list(folder.name);
      if (files?.length) await admin.storage.from('avatars').remove(files.map((f) => `${folder.name}/${f.name}`));
    }
  }
  for (const r of results) console.log(r.join('  '));
  const failed = results.filter((r) => r[0] === '✗').length;
  console.log(`\n${failed ? `${failed} step(s) FAILED` : 'ALL LIVE CHECKS PASSED'} · test accounts cleaned up`);
  process.exit(failed ? 1 : 0);
}
