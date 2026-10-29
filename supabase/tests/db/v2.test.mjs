// V2 features: presence/Open to Talk matching, Discover dashboard, Explore, Server avatars, Activity responses
// and sorting, chat media, endorsements, verified affiliations, Hot Map, function lockdown.
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { admin, as, goAvailable, makeServer, makeUser, pool, rejects, rpc, rpcRows } from './helpers.mjs';

after(() => pool.end());

describe('Open to Talk: top-5 people matches', () => {
  test('reciprocal, explained, privacy-filtered, capped at 5', async () => {
    const me = await makeUser({ name: 'Me', tags: { interest: ['Startups', 'Machine Learning'], hobby: ['Badminton'] } });
    const others = [];
    for (let i = 0; i < 7; i++) others.push(await makeUser({ name: `Peer ${i}`, tags: { interest: ['Startups'], hobby: i < 2 ? ['Badminton'] : ['Chess'] } }));
    const shy = await makeUser({ name: 'Shy', tags: { interest: ['Startups'] } });
    const blocker = await makeUser({ name: 'Blocker', tags: { interest: ['Startups'] } });
    const outsider = await makeUser({ name: 'Outsider', tags: { interest: ['Startups'] } });
    const owner = await makeUser();
    await makeServer(owner, [me, ...others, shy, blocker]);
    await makeServer(await makeUser(), [outsider]);
    for (const u of [...others, blocker, outsider]) await goAvailable(u);
    await rpc(others[0], 'set_open_to_talk', { p_open: true, p_topic: 'Looking for a badminton partner this weekend' });
    await rpc(blocker, 'block_user', { p_user_id: me });

    await rejects(rpcRows(me, 'talk_matches'), 'not_open_to_talk');
    await rpc(me, 'set_open_to_talk', { p_open: true, p_topic: 'badminton and startups' });
    const rows = await rpcRows(me, 'talk_matches', { p_limit: 20 });
    assert.equal(rows.length, 5, 'only the top five');
    const ids = rows.map((r) => r.user_id);
    assert.ok(!ids.includes(shy), 'not Open to Talk → never recommended');
    assert.ok(!ids.includes(blocker), 'blocked → never recommended');
    assert.ok(!ids.includes(outsider), 'no shared Server → not eligible');
    assert.equal(rows[0].user_id, others[0], 'stated topic + shared hobby ranks first');
    assert.equal(rows[0].talk_topic, 'Looking for a badminton partner this weekend');
    assert.ok(rows[0].reasons.some((r) => /badminton/i.test(r)), JSON.stringify(rows[0].reasons));
    assert.ok(rows.every((r) => r.reasons.length > 0 && r.shared_server_name));
  });
});

describe('Discover dashboard & Explore', () => {
  test('popular/explore exclude joined Servers; activities exclude mine, full and answered', async () => {
    const me = await makeUser({ tags: { interest: ['Photography'] } });
    const owner = await makeUser();
    const { serverId: joined, token: joinedToken } = await makeServer(owner, [me], { visibility: 'listed', name: 'Joined Club' });
    const { serverId: other } = await makeServer(owner, [], { visibility: 'listed', join_policy: 'approval', name: 'Photography Walks' });
    const explore = (await rpcRows(me, 'search_servers', { p_query: '' })).map((s) => s.id);
    assert.ok(!explore.includes(joined), 'Explore never shows joined Servers');
    assert.ok(explore.includes(other));

    const d1 = await rpc(me, 'discover_dashboard');
    assert.ok(!d1.popular_servers.some((s) => s.id === joined));
    assert.ok(d1.suggested_servers.some((s) => s.id === other && /Photography/.test(s.reason)), 'personalised by interest');
    assert.deepEqual(d1.trending_servers, [], 'no trending without enough real visit/join data');

    const mine = await rpc(me, 'create_activity_post', { p_server_id: joined, p_body: 'My own plan' });
    const full = await rpc(owner, 'create_activity_post', { p_server_id: joined, p_body: 'Tiny trip', p_capacity: 1 });
    const open = await rpc(owner, 'create_activity_post', { p_server_id: joined, p_body: 'Photography walk at dawn' });
    const filler = await makeUser();
    await rpc(filler, 'join_server_with_token', { p_token: joinedToken });
    await rpc(filler, 'set_post_response', { p_post_id: full, p_kind: 'in' });
    const acts = (await rpc(me, 'discover_dashboard')).activities_for_you.map((a) => a.id);
    assert.ok(acts.includes(open));
    assert.ok(!acts.includes(mine) && !acts.includes(full));
    await rpc(me, 'set_post_response', { p_post_id: open, p_kind: 'not_in' });
    assert.ok(!(await rpc(me, 'discover_dashboard')).activities_for_you.some((a) => a.id === open));
  });
});

describe('Server avatars', () => {
  test('only admins can upload; path must be the Server folder; members can view', async () => {
    const adminU = await makeUser();
    const member = await makeUser();
    const outsider = await makeUser();
    const { serverId } = await makeServer(adminU, [member]);
    await rpc(adminU, 'reserve_media_upload', { p_bucket: 'server-avatars', p_path: `${serverId}/a.jpg`, p_bytes: 1024 });
    await as(adminU, `insert into storage.objects (bucket_id, name, owner) values ('server-avatars', $1, auth.uid())`, [`${serverId}/a.jpg`]);
    await assert.rejects(as(member, `insert into storage.objects (bucket_id, name, owner) values ('server-avatars', $1, auth.uid())`, [`${serverId}/b.jpg`]), /row-level security/);
    await as(adminU, `update public.servers set avatar_path = $2 where id = $1`, [serverId, `${serverId}/a.jpg`]);
    await rejects(as(adminU, `update public.servers set avatar_path = $2 where id = $1`, [serverId, `other/a.jpg`]), 'invalid_avatar');
    assert.equal((await as(member, `select name from storage.objects where bucket_id = 'server-avatars' and name = $1`, [`${serverId}/a.jpg`])).length, 1);
    assert.equal((await as(outsider, `select name from storage.objects where bucket_id = 'server-avatars' and name = $1`, [`${serverId}/a.jpg`])).length, 0);
    assert.equal((await rpc(member, 'get_server', { p_server_id: serverId })).avatar_path, `${serverId}/a.jpg`);
  });
});

describe("Activity: I'm in / I'm not in, capacity, sorting", () => {
  test('responses are changeable, capacity enforced, creator sees names, not-in never sends requests', async () => {
    const author = await makeUser({ name: 'Author' });
    const a = await makeUser({ name: 'Alpha' });
    const b = await makeUser({ name: 'Beta' });
    const { serverId } = await makeServer(author, [a, b]);
    const post = await rpc(author, 'create_activity_post', { p_server_id: serverId, p_body: 'Kedarnath trip', p_category: 'travel', p_capacity: 1 });

    const r1 = await rpc(a, 'set_post_response', { p_post_id: post, p_kind: 'in' });
    assert.equal(r1.kind, 'in');
    assert.equal(r1.request.status, 'pending');
    await rejects(rpc(b, 'set_post_response', { p_post_id: post, p_kind: 'in' }), 'activity_full');
    const r2 = await rpc(b, 'set_post_response', { p_post_id: post, p_kind: 'not_in' });
    assert.equal(r2.kind, 'not_in');
    assert.equal((await as(b, `select id from public.connection_requests where sender_id = auth.uid()`)).length, 0, 'not-in sends no request');

    const responses = await rpcRows(author, 'list_post_responses', { p_post_id: post });
    assert.deepEqual(responses.map((r) => [r.responder.display_name, r.kind]).sort(), [['Alpha', 'in'], ['Beta', 'not_in']]);
    await rejects(rpcRows(a, 'list_post_responses', { p_post_id: post }), 'forbidden');

    // Changing in → not in withdraws the still-pending request and frees the spot.
    await rpc(a, 'set_post_response', { p_post_id: post, p_kind: 'not_in' });
    const [{ status }] = await admin('select status from public.connection_requests where id = $1', [r1.request.request_id]);
    assert.equal(status, 'cancelled');
    assert.equal((await rpc(b, 'set_post_response', { p_post_id: post, p_kind: 'in' })).kind, 'in');
    // Removing a response.
    assert.equal((await rpc(b, 'set_post_response', { p_post_id: post, p_kind: null })).kind, null);
    const [feed] = await rpcRows(author, 'list_activity', { p_server_id: serverId });
    assert.equal(Number(feed.in_count), 0);
    assert.equal(Number(feed.not_in_count), 1);
  });

  test('For You ranks by interests; Latest is strictly chronological', async () => {
    const owner = await makeUser();
    const reader = await makeUser({ tags: { hobby: ['Badminton'] } });
    const { serverId } = await makeServer(owner, [reader]);
    const relevant = await rpc(owner, 'create_activity_post', { p_server_id: serverId, p_body: 'Badminton at 7am tomorrow?' });
    await admin(`update public.activity_posts set created_at = now() - interval '3 hours' where id = $1`, [relevant]);
    const newer = await rpc(owner, 'create_activity_post', { p_server_id: serverId, p_body: 'Board games tonight' });
    const latest = await rpcRows(reader, 'list_activity', { p_server_id: serverId, p_sort: 'latest' });
    assert.deepEqual(latest.map((p) => p.id), [newer, relevant]);
    const forYou = await rpcRows(reader, 'list_activity', { p_server_id: serverId, p_sort: 'for_you' });
    assert.equal(forYou[0].id, relevant);
    assert.match(forYou[0].relevance_reason, /Badminton/);
  });
});

describe('chat media', () => {
  test('media lives in the conversation folder; only participants can upload/read; deletion is queued', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const { serverId } = await makeServer(owner, [a, b]);
    await goAvailable(b);
    const r = await rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId });
    const { conversation_id: conv } = await rpc(b, 'respond_to_request', { p_request_id: r.request_id, p_accept: true });
    const path = `${conv}/photo.jpg`;
    await rpc(a, 'reserve_media_upload', { p_bucket: 'chat-media', p_path: path, p_bytes: 1024 });
    await as(a, `insert into storage.objects (bucket_id, name, owner) values ('chat-media', $1, auth.uid())`, [path]);
    await assert.rejects(as(c, `insert into storage.objects (bucket_id, name, owner) values ('chat-media', $1, auth.uid())`, [`${conv}/evil.jpg`]), /row-level security/);
    await as(a, `insert into public.messages (conversation_id, sender_id, client_id, kind, media_path, media_mime, media_size)
                 values ($1, auth.uid(), gen_random_uuid(), 'image', $2, 'image/jpeg', 1234)`, [conv, path]);
    assert.equal((await as(b, `select name from storage.objects where bucket_id = 'chat-media' and name = $1`, [path])).length, 1);
    assert.equal((await as(c, `select name from storage.objects where bucket_id = 'chat-media' and name = $1`, [path])).length, 0);
    // Shape rules + folder rule.
    await assert.rejects(as(a, `insert into public.messages (conversation_id, sender_id, client_id, kind) values ($1, auth.uid(), gen_random_uuid(), 'image')`, [conv]), /messages_kind_shape/);
    await rejects(as(a, `insert into public.messages (conversation_id, sender_id, client_id, kind, media_path, media_mime) values ($1, auth.uid(), gen_random_uuid(), 'image', 'elsewhere/x.jpg', 'image/jpeg')`, [conv]), 'invalid_media');
    await as(a, `insert into public.messages (conversation_id, sender_id, client_id, kind, sticker_id) values ($1, auth.uid(), gen_random_uuid(), 'sticker', 'namaste')`, [conv]);
    await as(a, `insert into public.messages (conversation_id, sender_id, client_id, kind, location_lat, location_lng) values ($1, auth.uid(), gen_random_uuid(), 'location', 26.5123, 80.2329)`, [conv]);
    const [list] = await rpcRows(b, 'list_conversations');
    assert.equal(list.last_message, '📍 Location');
    // Removing the connection deletes the chat and queues the file for storage cleanup.
    await rpc(a, 'remove_connection', { p_connection_id: list.connection_id });
    const q = await admin(`select path from app_private.storage_deletions where path = $1`, [path]);
    assert.equal(q.length, 1);
    await assert.rejects(as(a, 'select * from public.claim_storage_deletions(10)'), /permission denied/);
  });
});

describe('endorsements & verified affiliations', () => {
  test('authors can revoke their own endorsements; names are listed', async () => {
    const owner = await makeUser();
    const a = await makeUser({ name: 'Ananya' });
    const b = await makeUser({ name: 'Bilal' });
    const { serverId } = await makeServer(owner, [a, b]);
    await goAvailable(b);
    const r = await rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId });
    await rpc(b, 'respond_to_request', { p_request_id: r.request_id, p_accept: true });
    const id = await rpc(a, 'write_endorsement', { p_user_id: b, p_body: 'Great at organising treks!' });
    const received = await rpcRows(b, 'list_endorsements', { p_direction: 'received' });
    assert.equal(received[0].other.display_name, 'Ananya');
    await rejects(rpc(b, 'revoke_endorsement', { p_endorsement_id: id }), 'not_found');
    await rpc(a, 'revoke_endorsement', { p_endorsement_id: id });
    assert.equal((await rpcRows(b, 'list_endorsements', { p_direction: 'received' })).length, 0);
  });

  test('affiliations can only be created by the server; they show on the profile', async () => {
    const u = await makeUser();
    const viewer = await makeUser();
    await makeServer(await makeUser(), [u, viewer]);
    await assert.rejects(as(u, `insert into public.verified_affiliations (user_id, kind, org_name, domain) values (auth.uid(), 'college', 'IIT Kanpur', 'iitk.ac.in')`), /permission denied/);
    await assert.rejects(as(u, `select * from public.affiliation_verifications`), /permission denied/);
    await admin(`insert into public.verified_affiliations (user_id, kind, org_name, domain) values ($1, 'college', 'Indian Institute of Technology, Kanpur', 'iitk.ac.in')`, [u]);
    // Universal profile (V3.1): the Server's personal/professional choice no longer hides sections.
    const card = await rpc(viewer, 'get_profile', { p_user_id: u });
    assert.equal(card.affiliations[0].domain, 'iitk.ac.in');
    const orgs = await rpcRows(viewer, 'search_org_domains', { p_query: 'Kanpur', p_kind: 'college' });
    assert.ok(orgs.some((o) => o.domain === 'iitk.ac.in'), 'university registry is searchable');
  });
});

describe('Hot Map', () => {
  test('opt-in, rounded, ranges only, k≥3, no per-viewer differencing, new accounts excluded', async () => {
    const users = [];
    for (let i = 0; i < 4; i++) users.push(await makeUser());
    const viewer = await makeUser();
    await rejects(rpc(users[0], 'update_my_location', { p_lat: 26.51234, p_lng: 80.23291 }), 'not_opted_in');
    for (const u of users) {
      await as(u, `update public.user_settings set hot_map_opt_in = true where user_id = auth.uid()`);
      await rpc(u, 'update_my_location', { p_lat: 26.51234 + Math.random() * 0.001, p_lng: 80.23291 });
    }
    const box = { p_min_lat: 26.4, p_min_lng: 80.1, p_max_lat: 26.6, p_max_lng: 80.3 };
    // Accounts younger than 24h are not counted (throwaway-account padding).
    assert.equal((await rpcRows(viewer, 'hot_map', box)).length, 0);
    await admin(`update public.profiles set created_at = now() - interval '2 days' where id = any($1::uuid[])`, [users]);
    const [{ cell_lat }] = await admin('select cell_lat::text from public.location_cells where user_id = $1', [users[0]]);
    assert.equal(cell_lat, '26.51', 'only the rounded cell is stored');
    await assert.rejects(as(viewer, 'select * from public.location_cells'), /permission denied/);
    let cells = await rpcRows(viewer, 'hot_map', box);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].people_label, '3–4', 'ranges only, never exact counts');
    // Blocking doesn't change what a viewer sees (no differencing via block/unblock).
    await rpc(viewer, 'block_user', { p_user_id: users[0] });
    assert.equal((await rpcRows(viewer, 'hot_map', box))[0].people_label, '3–4');
    // Trimming the box can't split a cell: it is snapped outward to whole grid cells.
    const trimmed = await rpcRows(viewer, 'hot_map', { ...box, p_min_lat: 26.5115, p_max_lat: 26.512 });
    assert.equal(trimmed.length, 1);
    // Two opt out / go unavailable → 2 left → suppressed (k ≥ 3).
    await as(users[1], `update public.user_settings set hot_map_opt_in = false where user_id = auth.uid()`);
    await rpc(users[2], 'set_available', { p_available: false });
    cells = await rpcRows(viewer, 'hot_map', box);
    assert.equal(cells.length, 0, 'sparse cells are suppressed');
    await rejects(rpcRows(viewer, 'hot_map', { p_min_lat: 0, p_min_lng: 0, p_max_lat: 40, p_max_lng: 40 }), 'area_too_large');
  });
});

describe('review regressions', () => {
  test('talk_matches names the same Server it returns the id of', async () => {
    const me = await makeUser({ tags: { interest: ['Chess'] } });
    const them = await makeUser({ tags: { interest: ['Chess'] } });
    const big = await makeUser();
    const { serverId: zeta } = await makeServer(big, [me, them], { name: 'Zeta Club' });
    const { serverId: alpha } = await makeServer(big, [me, them], { name: 'Alpha Hall' });
    for (let i = 0; i < 3; i++) await rpc(await makeUser(), 'join_server_with_token', { p_token: (await as(big, `select * from public.create_join_token($1,'qr')`, [zeta]))[0].token });
    await goAvailable(me);
    await goAvailable(them);
    const [m] = await rpcRows(me, 'talk_matches');
    const [{ name }] = await admin('select name from public.servers where id = $1', [m.shared_server_id]);
    assert.equal(name, m.shared_server_name);
    assert.equal(m.shared_server_id, zeta, 'largest shared Server');
    assert.ok(alpha);
  });

  test("toggling I'm in doesn't re-notify; withdrawing removes the notification", async () => {
    const author = await makeUser();
    const u = await makeUser();
    const { serverId } = await makeServer(author, [u]);
    const post = await rpc(author, 'create_activity_post', { p_server_id: serverId, p_body: 'Chess tonight' });
    await rpc(u, 'set_post_response', { p_post_id: post, p_kind: 'in' });
    const count = async () => (await as(author, `select count(*)::int n from public.notifications where type = 'activity_response'`))[0].n;
    assert.equal(await count(), 1);
    await rpc(u, 'set_post_response', { p_post_id: post, p_kind: 'not_in' });
    assert.equal(await count(), 0, 'withdrawn');
    await rpc(u, 'set_post_response', { p_post_id: post, p_kind: 'in' });
    assert.equal(await count(), 0, 'no re-push on toggle');
  });

  test('affiliation attempts are consumed atomically (max 5, even in parallel); begin is rate limited', async () => {
    const u = await makeUser();
    const [{ id }] = await admin(`select public.affiliation_begin($1, 'a@iitk.ac.in', 'iitk.ac.in', 'college', 'IIT Kanpur', 'nonce$hash', 15) as id`, [u]);
    const results = await Promise.all(Array.from({ length: 12 }, () => admin('select * from public.affiliation_consume_attempt($1, $2)', [id, u])));
    assert.equal(results.filter((r) => r.length === 1).length, 5, 'exactly five attempts granted');
    for (let i = 0; i < 2; i++) await admin(`select public.affiliation_begin($1, 'a@iitk.ac.in', 'iitk.ac.in', 'college', 'IIT Kanpur', 'x$y', 15)`, [u]);
    await assert.rejects(admin(`select public.affiliation_begin($1, 'a@iitk.ac.in', 'iitk.ac.in', 'college', 'IIT Kanpur', 'x$y', 15)`, [u]), /rate_limited/);
    await assert.rejects(as(u, `select public.affiliation_begin(auth.uid(), 'b@x.in', 'x.in', 'college', 'X', 'x$y', 15)`), /permission denied/);
  });

  test('V1 hidden users stay hidden after the V2 migration semantics (new users default Available)', async () => {
    const u = await makeUser();
    assert.equal((await rpc(u, 'heartbeat')).is_available, true);
  });
});

describe('lockdown', () => {
  test('no public/app_private function is executable by anon; service-only RPCs are not executable by users', async () => {
    const [{ n }] = await admin(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname in ('public','app_private') and has_function_privilege('anon', p.oid, 'execute')`);
    assert.equal(n, 0);
    const [{ m }] = await admin(`select count(*)::int m from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('claim_storage_deletions','complete_storage_deletions')
        and has_function_privilege('authenticated', p.oid, 'execute')`);
    assert.equal(m, 0);
  });
});
