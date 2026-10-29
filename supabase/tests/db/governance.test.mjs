// Roles, nested Servers, badges, ephemeral expiry, safety filter, activity, rate limits, concurrency.
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { admin, as, goAvailable, makeServer, makeUser, pool, rejects, rpc, rpcRows } from './helpers.mjs';

after(() => pool.end());

describe('onboarding & profile privacy', () => {
  test('under-18 users are rejected', async () => {
    const u = await makeUser({ onboard: false });
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 17);
    await rejects(
      rpc(u, 'complete_onboarding', { p_username: 'teen_user_x', p_display_name: 'Teen', p_date_of_birth: dob.toISOString().slice(0, 10) }),
      'underage',
    );
    // Not onboarded → social actions blocked.
    await rejects(rpc(u, 'set_availability', { p_minutes: 30 }), 'onboarding_required');
  });

  test('usernames are validated and unique', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await rejects(rpc(a, 'set_username', { p_username: 'Bad Name!' }), 'invalid_username');
    await rpc(a, 'set_username', { p_username: 'taken_name' });
    await rejects(rpc(b, 'set_username', { p_username: 'TAKEN_NAME' }), 'username_taken');
  });

  test('nobody can read another user\'s profile/private rows directly', async () => {
    const a = await makeUser({ gender: 'woman' });
    const b = await makeUser();
    assert.equal((await as(b, 'select * from public.profiles where id = $1', [a])).length, 0);
    assert.equal((await as(b, 'select * from public.profile_private where user_id = $1', [a])).length, 0);
    assert.equal((await as(b, 'select * from public.user_settings where user_id = $1', [a])).length, 0);
    assert.equal((await as(b, 'select * from public.presence where user_id = $1', [a])).length, 0);
    // own rows are readable
    assert.equal((await as(a, 'select gender from public.profile_private where user_id = auth.uid()'))[0].gender, 'woman');
  });

  test('users cannot edit protected columns or other users', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await assert.rejects(as(a, `update public.profiles set account_status = 'active' where id = auth.uid()`), /permission denied/);
    await assert.rejects(as(a, `update public.profiles set username = 'hijack' where id = auth.uid()`), /permission denied/);
    await assert.rejects(as(a, `update public.profile_private set date_of_birth = '2015-01-01' where user_id = auth.uid()`), /permission denied/);
    const rows = await as(a, `update public.profiles set bio = 'pwned' where id = $1 returning id`, [b]);
    assert.equal(rows.length, 0);
  });

  test('Available (default ON) controls whether co-members can see your card', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    await makeServer(owner, [a, b]);
    // V2: Available is ON by default, so co-members can see each other's limited card…
    assert.ok(await rpc(a, 'get_profile', { p_user_id: b }));
    // …and turning Available OFF hides it again (no ghost profiles).
    await rpc(b, 'set_available', { p_available: false });
    await rejects(rpc(a, 'get_profile', { p_user_id: b }), 'not_found');
    // …but the Server's staff can see their members (for management).
    assert.ok(await rpc(owner, 'get_profile', { p_user_id: b }));
  });
});

describe('gender safety filter', () => {
  test('same-gender-only is symmetric and never reveals gender', async () => {
    const owner = await makeUser();
    const w1 = await makeUser({ gender: 'woman', audience: 'same_gender' });
    const w2 = await makeUser({ gender: 'woman' });
    const m1 = await makeUser({ gender: 'man' });
    const { serverId } = await makeServer(owner, [w1, w2, m1]);
    for (const u of [w1, w2, m1]) await goAvailable(u);

    const seenByMan = (await rpcRows(m1, 'discover_people', { p_server_id: serverId })).map((r) => r.user_id);
    const seenByWoman = (await rpcRows(w2, 'discover_people', { p_server_id: serverId })).map((r) => r.user_id);
    const seenByW1 = (await rpcRows(w1, 'discover_people', { p_server_id: serverId })).map((r) => r.user_id);
    assert.ok(!seenByMan.includes(w1));
    assert.ok(seenByWoman.includes(w1));
    assert.ok(!seenByW1.includes(m1), 'filter applies both ways');
    await rejects(rpc(m1, 'get_profile', { p_user_id: w1 }), 'not_found');
    const card = await rpc(w2, 'get_profile', { p_user_id: w1 });
    assert.ok(!('gender' in card));
    // Requires a declared gender.
    const x = await makeUser();
    await rejects(as(x, `update public.profile_private set discovery_audience = 'same_gender' where user_id = auth.uid()`), 'gender_required');
  });
});

describe('server roles, nesting and badges', () => {
  let admin1, mod, member, outsider, parent, child, parentToken;

  test('setup', async () => {
    admin1 = await makeUser({ name: 'Admin' });
    mod = await makeUser({ name: 'Mod' });
    member = await makeUser({ name: 'Member' });
    outsider = await makeUser({ name: 'Outsider' });
    ({ serverId: parent, token: parentToken } = await makeServer(admin1, [mod, member], { name: 'IIT Kanpur', category: 'university' }));
    await rpc(admin1, 'set_member_role', { p_server_id: parent, p_user_id: mod, p_role: 'moderator' });
  });

  test('only parent admins can create sub-Servers; depth is tracked', async () => {
    await rejects(rpc(member, 'create_server', { p_name: 'Hall 4', p_kind: 'long_term', p_parent_id: parent }), 'forbidden');
    await rejects(rpc(mod, 'create_server', { p_name: 'Hall 4', p_kind: 'long_term', p_parent_id: parent }), 'forbidden');
    child = await rpc(admin1, 'create_server', { p_name: 'Hall 4', p_kind: 'long_term', p_parent_id: parent, p_requires_parent_membership: true });
    const [row] = await admin('select depth from public.servers where id = $1', [child]);
    assert.equal(row.depth, 1);
  });

  test('membership does not propagate; parent membership can be required', async () => {
    const [tok] = await as(admin1, `select * from public.create_join_token($1, 'code')`, [child]);
    assert.match(tok.token, /^[A-Z2-9]{8}$/);
    await rejects(rpc(outsider, 'join_server_with_token', { p_token: tok.token.toLowerCase() }), 'parent_membership_required');
    const res = await rpc(member, 'join_server_with_token', { p_token: tok.token.toLowerCase() });
    assert.equal(res.status, 'active');
    // Joining the child did not make `outsider` a parent member, nor vice versa.
    assert.equal((await rpcRows(outsider, 'list_my_servers')).length, 0);
  });

  test('parent admin inherits admin rights on the child; moderators do not', async () => {
    const stats = await rpc(admin1, 'server_stats', { p_server_id: child });
    assert.equal(Number(stats.active_members), 2);
    await rejects(rpc(mod, 'server_stats', { p_server_id: child }), 'forbidden');
  });

  test('regular members cannot manage the Server', async () => {
    await rejects(as(member, `select * from public.create_join_token($1, 'qr')`, [parent]), 'forbidden');
    await rejects(rpc(member, 'grant_badge', { p_server_id: parent, p_user_id: member, p_kind: 'student', p_label: 'IITK Student' }), 'forbidden');
    await rejects(rpcRows(member, 'list_server_members', { p_server_id: parent }), 'forbidden');
    const upd = await as(member, `update public.servers set name = 'Hacked' where id = $1 returning id`, [parent]);
    assert.equal(upd.length, 0);
    await assert.rejects(as(admin1, `update public.servers set is_official = true where id = $1`, [parent]), /permission denied/);
    // Membership list is private: a member sees only their own row.
    const rows = await as(member, 'select user_id from public.server_members where server_id = $1', [parent]);
    assert.deepEqual(rows.map((r) => r.user_id), [member]);
    // Tokens are staff-only.
    assert.equal((await as(member, 'select * from public.server_join_tokens where server_id = $1', [parent])).length, 0);
  });

  test('admins can edit settings through RLS', async () => {
    const upd = await as(admin1, `update public.servers set description = 'Official IITK server' where id = $1 returning id`, [parent]);
    assert.equal(upd.length, 1);
  });

  test('badges: admin-granted with provenance, only to members, revocable', async () => {
    await rejects(rpc(admin1, 'grant_badge', { p_server_id: parent, p_user_id: outsider, p_kind: 'student', p_label: 'IITK Student' }), 'not_member');
    const badgeId = await rpc(admin1, 'grant_badge', { p_server_id: parent, p_user_id: member, p_kind: 'student', p_label: 'IITK Student' });
    await rejects(rpc(admin1, 'grant_badge', { p_server_id: parent, p_user_id: member, p_kind: 'student', p_label: 'Dup' }), 'badge_exists');
    const [b] = await admin('select issued_by, status from public.server_badges where id = $1', [badgeId]);
    assert.equal(b.issued_by, admin1);
    const own = await rpc(member, 'get_profile', { p_user_id: member });
    assert.equal(own.badges[0].label, 'IITK Student');
    await rpc(admin1, 'revoke_badge', { p_badge_id: badgeId, p_reason: 'graduated' });
    assert.equal((await rpc(member, 'get_profile', { p_user_id: member })).badges.length, 0);
    const log = await rpcRows(admin1, 'list_audit_log', { p_server_id: parent });
    assert.ok(log.some((l) => l.action === 'badge_granted'));
    assert.ok(log.some((l) => l.action === 'badge_revoked'));
  });

  test('moderators cannot remove members; admin bans block re-joining via token', async () => {
    await rejects(rpc(mod, 'ban_member', { p_server_id: parent, p_user_id: admin1 }), 'forbidden');
    const victim = await makeUser();
    await rpc(victim, 'join_server_with_token', { p_token: parentToken });
    await rejects(rpc(mod, 'ban_member', { p_server_id: parent, p_user_id: victim, p_reason: 'spam' }), 'forbidden');
    await rejects(rpc(mod, 'remove_member', { p_server_id: parent, p_user_id: victim }), 'forbidden');
    await rpc(admin1, 'ban_member', { p_server_id: parent, p_user_id: victim, p_reason: 'spam' });
    await rejects(rpc(victim, 'join_server_with_token', { p_token: parentToken }), 'banned');
    await rejects(rpc(victim, 'leave_server', { p_server_id: parent }), 'banned');
  });

  test('last admin cannot leave a populated Server', async () => {
    await rejects(rpc(admin1, 'leave_server', { p_server_id: parent }), 'last_admin');
  });

  test('approval-policy Servers create pending memberships that staff approve', async () => {
    const { serverId, token } = await makeServer(admin1, [], { join_policy: 'approval' });
    const applicant = await makeUser();
    assert.equal((await rpc(applicant, 'join_server_with_token', { p_token: token })).status, 'pending');
    await goAvailable(applicant);
    await rejects(rpcRows(applicant, 'discover_people', { p_server_id: serverId }), 'forbidden');
    const pending = await rpcRows(admin1, 'list_server_members', { p_server_id: serverId, p_status: 'pending' });
    assert.equal(pending[0].user_id, applicant);
    await rpc(admin1, 'review_membership', { p_server_id: serverId, p_user_id: applicant, p_approve: true });
    const mine = await rpcRows(applicant, 'list_my_servers');
    assert.equal(mine.find((s) => s.id === serverId).status, 'active');
  });

  test('tokens: revocation and max uses are enforced', async () => {
    const [t] = await as(admin1, `select * from public.create_join_token($1, 'link', null, 1)`, [parent]);
    const u1 = await makeUser();
    const u2 = await makeUser();
    await rpc(u1, 'join_server_with_token', { p_token: t.token });
    assert.equal((await rpc(u2, 'join_server_with_token', { p_token: t.token })).status, 'invalid');
    const [t2] = await as(admin1, `select * from public.create_join_token($1, 'qr')`, [parent]);
    await rpc(admin1, 'revoke_join_token', { p_token_id: t2.id });
    assert.equal((await rpc(u2, 'join_server_with_token', { p_token: t2.token })).status, 'invalid');
  });

  test('only platform admins create global Servers or verify Servers', async () => {
    await rejects(rpc(admin1, 'create_server', { p_name: 'Bangalore Tech', p_kind: 'global' }), 'forbidden');
    await rejects(rpc(admin1, 'set_server_official', { p_server_id: parent, p_official: true }), 'forbidden');
    await admin('insert into public.platform_admins (user_id) values ($1)', [outsider]);
    await rpc(outsider, 'set_server_official', { p_server_id: parent, p_official: true });
    assert.equal((await rpc(admin1, 'get_server', { p_server_id: parent })).is_official, true);
  });
});

describe('short-term Servers & ephemeral chat', () => {
  test('connections expire with the event unless both save; ended Servers close', async () => {
    const host = await makeUser();
    const a = await makeUser({ tags: { interest: ['Indie music'] } });
    const b = await makeUser({ tags: { interest: ['Indie music'] } });
    const c = await makeUser({ tags: { interest: ['Indie music'] } });
    const endsAt = new Date(Date.now() + 3 * 3600_000).toISOString();
    const { serverId, token } = await makeServer(host, [a, b, c], { kind: 'short_term', category: 'concert', ends_at: endsAt, ephemeral: true });
    for (const u of [a, b, c]) await goAvailable(u);

    const r1 = await rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId });
    const acc1 = await rpc(b, 'respond_to_request', { p_request_id: r1.request_id, p_accept: true });
    const r2 = await rpc(a, 'send_connection_request', { p_recipient: c, p_server_id: serverId });
    const acc2 = await rpc(c, 'respond_to_request', { p_request_id: r2.request_id, p_accept: true });

    const conv = await rpc(a, 'get_conversation', { p_conversation_id: acc1.conversation_id });
    assert.equal(new Date(conv.expires_at).toISOString(), endsAt);

    // a & b both save → becomes permanent.
    await rpc(a, 'save_connection', { p_connection_id: acc1.connection_id });
    const saved = await rpc(b, 'save_connection', { p_connection_id: acc1.connection_id });
    assert.equal(saved.is_friend, true);
    assert.equal(saved.expires_at, null);

    await as(a, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, auth.uid(), gen_random_uuid(), 'see you at the merch stand')`, [acc2.conversation_id]);
    await rpc(c, 'create_activity_post', { p_server_id: serverId, p_body: 'Anyone heading to the afterparty?' });

    // Time passes: the event ends.
    await admin(`update public.servers set starts_at = now() - interval '5 hours', ends_at = now() - interval '1 minute' where id = $1`, [serverId]);
    await admin(`update public.connections set expires_at = now() - interval '1 minute' where id = $1`, [acc2.connection_id]);
    const report = (await admin('select app_private.run_maintenance() as r'))[0].r;
    assert.ok(report.expired_connections >= 1);

    assert.equal((await admin('select count(*)::int n from public.messages where conversation_id = $1', [acc2.conversation_id]))[0].n, 0, 'ephemeral messages deleted');
    assert.equal((await admin('select count(*)::int n from public.connections where id = $1', [acc2.connection_id]))[0].n, 0);
    assert.equal((await admin('select count(*)::int n from public.connections where id = $1', [acc1.connection_id]))[0].n, 1, 'saved friendship kept');
    assert.equal((await admin('select count(*)::int n from public.activity_posts where server_id = $1', [serverId]))[0].n, 0);
    const s = await rpc(a, 'get_server', { p_server_id: serverId });
    assert.equal(s.is_live, false);
    assert.equal(s.is_archived, true);
    await rejects(rpcRows(a, 'discover_people', { p_server_id: serverId }), 'server_closed');
    const late = await makeUser();
    assert.equal((await rpc(late, 'join_server_with_token', { p_token: token })).status, 'invalid');
  });

  test('users are warned before an ephemeral chat expires', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const endsAt = new Date(Date.now() + 20 * 60_000).toISOString();
    const { serverId } = await makeServer(host, [a, b], { kind: 'short_term', ends_at: endsAt, ephemeral: true });
    await goAvailable(b);
    const r = await rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId });
    await rpc(b, 'respond_to_request', { p_request_id: r.request_id, p_accept: true });
    await admin('select app_private.run_maintenance()');
    const notes = await as(a, `select type from public.notifications where type = 'ephemeral_expiring'`);
    assert.equal(notes.length, 1);
    await admin('select app_private.run_maintenance()');
    assert.equal((await as(a, `select type from public.notifications where type = 'ephemeral_expiring'`)).length, 1, 'deduped');
  });

  test('presence: Available defaults ON and persists; Open to Talk defaults OFF; OFF clears Open to Talk', async () => {
    const u = await makeUser();
    let p = await rpc(u, 'heartbeat');
    assert.equal(p.is_available, true);
    assert.equal(p.open_to_talk, false);
    p = await rpc(u, 'set_open_to_talk', { p_open: true, p_topic: 'Startups and badminton' });
    assert.equal(p.open_to_talk, true);
    assert.equal(p.talk_topic, 'Startups and badminton');
    p = await rpc(u, 'set_available', { p_available: false });
    assert.equal(p.is_available, false);
    assert.equal(p.open_to_talk, false, 'unavailable users are never recommended');
    await rejects(rpc(u, 'set_open_to_talk', { p_open: true, p_topic: 'x'.repeat(141) }), 'invalid_topic');
  });
});

describe('activity hub', () => {
  test('scoped posts, responses become requests, authors and moderators control content', async () => {
    const owner = await makeUser();
    const author = await makeUser({ name: 'Author' });
    const reader = await makeUser({ name: 'Reader' });
    const outsider = await makeUser();
    const { serverId } = await makeServer(owner, [author, reader]);
    const postId = await rpc(author, 'create_activity_post', { p_server_id: serverId, p_body: 'Kedarnath trip, need 2 more people', p_category: 'travel' });
    assert.equal((await rpcRows(reader, 'list_activity', { p_server_id: serverId })).length, 1);
    assert.equal((await rpcRows(outsider, 'list_activity')).length, 0);
    await rejects(rpc(outsider, 'respond_to_activity_post', { p_post_id: postId }), 'not_found');
    // The author is viewable by co-members through their post even while not available.
    assert.equal((await rpc(reader, 'get_profile', { p_user_id: author })).display_name, 'Author');

    const res = await rpc(reader, 'respond_to_activity_post', { p_post_id: postId, p_message: 'I\'m in!' });
    assert.equal(res.request.status, 'pending');
    await rejects(rpc(reader, 'respond_to_activity_post', { p_post_id: postId }), 'already_responded');
    const responses = await rpcRows(author, 'list_post_responses', { p_post_id: postId });
    assert.equal(responses.length, 1);
    await rejects(rpcRows(reader, 'list_post_responses', { p_post_id: postId }), 'forbidden');

    await rejects(rpc(reader, 'delete_activity_post', { p_post_id: postId }), 'not_found');
    await rejects(rpc(reader, 'moderate_remove_post', { p_post_id: postId }), 'forbidden');
    await rpc(owner, 'moderate_remove_post', { p_post_id: postId, p_reason: 'test' });
    assert.equal((await rpcRows(reader, 'list_activity', { p_server_id: serverId })).length, 0);
  });
});

describe('abuse protection & concurrency', () => {
  test('join attempts are rate limited', async () => {
    const u = await makeUser();
    for (let i = 0; i < 20; i++) {
      assert.equal((await rpc(u, 'join_server_with_token', { p_token: `bogus-token-${i}-xxxxxxxxxxxx` })).status, 'invalid');
    }
    await rejects(rpc(u, 'join_server_with_token', { p_token: 'bogus-token-final-xxxxxxxx' }), 'rate_limited');
  });

  test('declined requests have a cooldown', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { serverId } = await makeServer(owner, [a, b]);
    await goAvailable(b);
    const r = await rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId });
    await rpc(b, 'respond_to_request', { p_request_id: r.request_id, p_accept: false });
    await rejects(rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId }), 'cooldown');
  });

  test('crossed requests resolve into one connection', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { serverId } = await makeServer(owner, [a, b]);
    await goAvailable(a);
    await goAvailable(b);
    await rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId });
    const res = await rpc(b, 'send_connection_request', { p_recipient: a, p_server_id: serverId });
    assert.equal(res.status, 'accepted');
    assert.equal((await rpcRows(a, 'list_connections')).length, 1);
  });

  test('concurrent double-accept creates exactly one connection', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { serverId } = await makeServer(owner, [a, b]);
    await goAvailable(b);
    const r = await rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId });
    const results = await Promise.allSettled([
      rpc(b, 'respond_to_request', { p_request_id: r.request_id, p_accept: true }),
      rpc(b, 'respond_to_request', { p_request_id: r.request_id, p_accept: true }),
      rpc(b, 'respond_to_request', { p_request_id: r.request_id, p_accept: false }),
    ]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
    const [{ n }] = await admin(
      'select count(*)::int n from public.connections where user_a = least($1::uuid,$2::uuid) and user_b = greatest($1::uuid,$2::uuid)', [a, b]);
    assert.ok(n <= 1);
  });

  test('message flood is rate limited', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { serverId } = await makeServer(owner, [a, b]);
    await goAvailable(b);
    const r = await rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId });
    const { conversation_id } = await rpc(b, 'respond_to_request', { p_request_id: r.request_id, p_accept: true });
    for (let i = 0; i < 40; i++) {
      await as(a, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, auth.uid(), gen_random_uuid(), 'm')`, [conversation_id]);
    }
    await rejects(as(a, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, auth.uid(), gen_random_uuid(), 'm')`, [conversation_id]), 'rate_limited');
  });

  test('suspended accounts cannot act and disappear from discovery', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const bad = await makeUser();
    const staff = await makeUser();
    await admin('insert into public.platform_admins (user_id) values ($1)', [staff]);
    const { serverId } = await makeServer(owner, [a, bad]);
    await goAvailable(a);
    await goAvailable(bad);
    assert.ok((await rpcRows(a, 'discover_people', { p_server_id: serverId })).some((r) => r.user_id === bad));
    await rpc(staff, 'set_account_status', { p_user_id: bad, p_status: 'suspended', p_reason: 'abuse' });
    assert.ok(!(await rpcRows(a, 'discover_people', { p_server_id: serverId })).some((r) => r.user_id === bad));
    await rejects(rpc(bad, 'set_availability', { p_minutes: 30 }), 'account_suspended');
  });

  test('storage: users can only write avatars into their own folder', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await rpc(a, 'reserve_media_upload', { p_bucket: 'avatars', p_path: `${a}/me.jpg`, p_bytes: 1024 });
    await as(a, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${a}/me.jpg`]);
    await assert.rejects(as(a, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${b}/evil.jpg`]), /row-level security/);
    // b cannot read a's avatar (no relationship)
    assert.equal((await as(b, `select name from storage.objects where bucket_id = 'avatars' and name = $1`, [`${a}/me.jpg`])).length, 0);
  });

  test('a REPORTED user can still delete their account (reports keep the evidence, lose the link)', async () => {
    const owner = await makeUser();
    const bad = await makeUser();
    const reporter = await makeUser();
    const { serverId } = await makeServer(owner, [bad, reporter]);
    const reportId = await rpc(reporter, 'create_report', { p_reason: 'spam', p_target_user: bad, p_server_id: serverId });
    await admin('delete from auth.users where id = $1', [bad]);
    const [r] = await admin('select target_user_id, reason from public.reports where id = $1', [reportId]);
    assert.equal(r.target_user_id, null);
    assert.equal(r.reason, 'spam');
    await rejects(rpc(reporter, 'create_report', { p_reason: 'spam' }), 'invalid_target');
  });

  test('account deletion cascades personal data', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { serverId } = await makeServer(owner, [a, b]);
    await goAvailable(b);
    const r = await rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId });
    const { conversation_id } = await rpc(b, 'respond_to_request', { p_request_id: r.request_id, p_accept: true });
    await as(a, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, auth.uid(), gen_random_uuid(), 'bye')`, [conversation_id]);
    await admin('delete from auth.users where id = $1', [a]); // what the delete-account Edge Function does
    for (const t of ['profiles where id', 'profile_private where user_id', 'server_members where user_id', 'messages where sender_id', 'presence where user_id']) {
      const [{ n }] = await admin(`select count(*)::int n from public.${t} = $1`, [a]);
      assert.equal(n, 0, t);
    }
    assert.equal((await rpcRows(b, 'list_conversations')).length, 0);
  });
});
