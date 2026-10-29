// V3 requirement checks (change_sniffin_v3 §3–§10), run as `authenticated` exactly like PostgREST.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { admin, as, makeServer, makeUser, rejects, rpc, rpcRows } from './helpers.mjs';

const soon = (h) => new Date(Date.now() + h * 3600_000).toISOString();

async function uploadObject(uid, bucket, path) {
  await rpc(uid, 'reserve_media_upload', { p_bucket: bucket, p_path: path, p_bytes: 1000 });
  await admin(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, '{"size":1000}')`, [bucket, path, uid]);
}

describe('§3 temporary Servers and Open to Talk', () => {
  test('QR join with Open to Talk: duration, topic, location hint; others see it; it expires', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { serverId, token } = await makeServer(owner, [], { kind: 'short_term', ends_at: soon(6), category: 'event' });
    const joined = await rpc(a, 'join_server_with_preferences', {
      p_token: token, p_mode: 'both', p_open: true, p_minutes: 30, p_topic: 'Startups and chai', p_location_hint: 'Table 18',
    });
    assert.equal(joined.status, 'active');
    await rpc(b, 'join_server_with_preferences', { p_token: token, p_mode: 'personal', p_open: false });

    const seen = await rpcRows(b, 'venue_people', { p_server_id: serverId });
    assert.equal(seen.length, 1, 'only the person who opted in is shown');
    assert.equal(seen[0].location_hint, 'Table 18');
    assert.equal(seen[0].topic, 'Startups and chai');
    const fromA = await rpcRows(a, 'venue_people', { p_server_id: serverId });
    assert.equal(fromA.length, 0, 'people who declined are not presented as available');

    // Custom duration (4 h) is capped by the Server end time; ending early removes the person.
    const four = await rpc(a, 'set_venue_session', { p_server_id: serverId, p_open: true, p_minutes: 240, p_topic: null, p_location_hint: null, p_mode: 'both' });
    assert.ok(new Date(four.ends_at) - Date.now() > 3.9 * 3600_000);
    await rpc(a, 'end_venue_session', { p_server_id: serverId });
    assert.equal((await rpcRows(b, 'venue_people', { p_server_id: serverId })).length, 0);

    // Expiry: an expired session is never shown.
    await rpc(a, 'set_venue_session', { p_server_id: serverId, p_open: true, p_minutes: 30, p_topic: null, p_location_hint: null, p_mode: 'both' });
    await admin(`update public.venue_sessions set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second' where user_id = $1`, [a]);
    assert.equal((await rpcRows(b, 'venue_people', { p_server_id: serverId })).length, 0);
    await rejects(rpc(a, 'set_venue_session', { p_server_id: serverId, p_open: true, p_minutes: 0, p_topic: null, p_location_hint: null, p_mode: 'both' }), 'invalid_duration');
  });

  test('a person Open to Talk at a venue can be opened from the venue; a decliner shows no venue status', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { serverId, token } = await makeServer(owner, [], { kind: 'short_term', ends_at: soon(3), category: 'event' });
    await rpc(a, 'join_server_with_preferences', { p_token: token, p_mode: 'both', p_open: true, p_minutes: 60, p_topic: 'Music', p_location_hint: 'Bar' });
    await rpc(b, 'join_server_with_preferences', { p_token: token, p_mode: 'both', p_open: false });
    const view = await rpc(b, 'get_profile_in_server', { p_user_id: a, p_server_id: serverId });
    assert.equal(view.venue_location_hint, 'Bar');
    assert.equal(view.server_context.kind, 'short_term');
    const decliner = await rpc(a, 'get_profile_in_server', { p_user_id: b, p_server_id: serverId }).catch(() => null);
    assert.equal(decliner?.venue_location_hint ?? null, null, 'no Open to Talk status for someone who declined');
  });

  test('Hot Map and nearby venue cards aggregate participants with a k>=3 floor', async () => {
    const owner = await makeUser();
    const { serverId, token } = await makeServer(owner, [], { kind: 'short_term', ends_at: soon(4), category: 'event', visibility: 'listed' });
    await admin(`update public.servers set venue_lat = 26.51, venue_lng = 80.23 where id = $1`, [serverId]);
    const people = [];
    for (let i = 0; i < 4; i++) people.push(await makeUser());
    for (const [i, p] of people.entries()) {
      await rpc(p, 'join_server_with_preferences', { p_token: token, p_mode: 'both', p_open: i < 2, p_minutes: 60 });
    }
    const near = await rpcRows(people[0], 'venue_nearby', { p_lat: 26.5, p_lng: 80.2, p_radius_km: 5 });
    const card = near.find((v) => v.server_id === serverId);
    assert.ok(card, 'venue appears on Home');
    assert.equal(card.participants, 4);
    assert.equal(card.open_to_talk, 2);
    const cells = await rpcRows(people[0], 'venue_hot_map', { p_min_lat: 26, p_min_lng: 80, p_max_lat: 27, p_max_lng: 81 });
    assert.ok(cells.some((c) => c.server_ids.includes(serverId) && c.people >= 3 && Number(c.intensity) > 0));
    // Stale sessions stop counting.
    await admin(`update public.venue_sessions set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 minute' where server_id = $1 and user_id = any($2)`, [serverId, people.slice(0, 2)]);
    const after = await rpcRows(people[0], 'venue_nearby', { p_lat: 26.5, p_lng: 80.2, p_radius_km: 5 });
    assert.ok(!after.some((v) => v.server_id === serverId), 'fewer than 3 live participants is suppressed');
  });
});

describe('§4 permanent Servers: member info, directory, roles, badges', () => {
  test('creator is admin; server info exposes creator, created date, member count; member tag is configurable', async () => {
    const owner = await makeUser({ name: 'Owner' });
    const m = await makeUser();
    const { serverId } = await makeServer(owner, [m], { category: 'apartment' });
    const rows = await as(owner, `update public.servers set member_field_label = 'Flat number', member_field_hint = 'e.g. B-402' where id = $1 returning id`, [serverId]);
    assert.equal(rows.length, 1, 'admin can configure the member field');
    await rpc(m, 'set_server_profile', { p_server_id: serverId, p_mode: 'both', p_note: 'B-402' });
    const info = await rpc(m, 'get_server', { p_server_id: serverId });
    assert.equal(info.creator.display_name, 'Owner');
    assert.ok(info.created_at);
    assert.equal(info.member_count, 2);
    assert.equal(info.member_field_label, 'Flat number');
    const dir = await rpcRows(m, 'server_directory', { p_server_id: serverId });
    assert.equal(dir[0].role, 'admin', 'admins are listed first');
    assert.equal(dir.find((d) => d.user_id === m).member_note, 'B-402');
    const asMember = await as(m, `update public.servers set member_field_label = 'x' where id = $1 returning id`, [serverId]);
    assert.equal(asMember.length, 0, 'members cannot change server settings');
  });

  test('moderators assign badges but cannot remove members or appoint roles; admins can', async () => {
    const owner = await makeUser();
    const mod = await makeUser();
    const m = await makeUser();
    const { serverId } = await makeServer(owner, [mod, m]);
    await rpc(owner, 'set_member_role', { p_server_id: serverId, p_user_id: mod, p_role: 'moderator' });
    const badge = await rpc(mod, 'grant_badge', { p_server_id: serverId, p_user_id: m, p_kind: 'custom', p_label: 'Football captain', p_expires_at: null });
    assert.ok(badge);
    await rejects(rpc(mod, 'remove_member', { p_server_id: serverId, p_user_id: m }), 'forbidden');
    await rejects(rpc(mod, 'set_member_role', { p_server_id: serverId, p_user_id: m, p_role: 'moderator' }), 'forbidden');
    await rejects(rpc(m, 'grant_badge', { p_server_id: serverId, p_user_id: mod, p_kind: 'custom', p_label: 'x', p_expires_at: null }), 'forbidden');
    await rpc(owner, 'remove_member', { p_server_id: serverId, p_user_id: m });
  });

  test('badges are permanent-Server only and visible only through mutual Servers', async () => {
    const owner = await makeUser();
    const holder = await makeUser();
    const mutual = await makeUser();
    const outsider = await makeUser();
    const { serverId } = await makeServer(owner, [holder, mutual]);
    const secondShared = await makeServer(owner, [holder, mutual]);
    await makeServer(await makeUser(), [holder, outsider]);
    await rpc(owner, 'grant_badge', { p_server_id: serverId, p_user_id: holder, p_kind: 'custom', p_label: 'Mess secretary', p_expires_at: null });
    await rpc(owner, 'grant_badge', { p_server_id: secondShared.serverId, p_user_id: holder, p_kind: 'custom', p_label: 'Club organiser', p_expires_at: null });
    const temp = await makeServer(owner, [holder], { kind: 'short_term', ends_at: soon(2), category: 'event' });
    await rejects(rpc(owner, 'grant_badge', { p_server_id: temp.serverId, p_user_id: holder, p_kind: 'custom', p_label: 'x', p_expires_at: null }), 'permanent_only');
    const seenByMutual = await rpc(mutual, 'get_profile_in_server', { p_user_id: holder, p_server_id: serverId });
    assert.deepEqual(seenByMutual.badges.map((b) => b.label).sort(), ['Club organiser', 'Mess secretary']);
    await rpc(holder, 'set_open_to_talk', { p_open: true, p_topic: null });
    const seenByOutsider = await rpc(outsider, 'get_profile', { p_user_id: holder });
    assert.deepEqual(seenByOutsider.badges, [], 'no badge leaks through a Server the viewer is not in');
  });

  test('members of a live permanent Server can open each other from the directory, unless blocked', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { serverId } = await makeServer(owner, [a, b]);
    await rpc(a, 'set_available', { p_available: false });
    const view = await rpc(b, 'get_profile_in_server', { p_user_id: a, p_server_id: serverId });
    assert.equal(view.id, a);
    assert.equal(view.server_context.server_id, serverId);
    await rpc(a, 'block_user', { p_user_id: b });
    await rejects(rpc(b, 'get_profile_in_server', { p_user_id: a, p_server_id: serverId }), 'not_found');
  });
});

describe('§5 universal profile, photos, preview', () => {
  test('personal and professional sections are shown together regardless of Server choice', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { serverId } = await makeServer(owner, [a, b]);
    await as(a, `update public.profiles set bio = 'Loves trekking', professional_bio = 'Backend engineer', occupation = 'Engineer' where id = auth.uid()`);
    await rpc(a, 'set_server_profile', { p_server_id: serverId, p_mode: 'personal', p_note: null });
    const view = await rpc(b, 'get_profile_in_server', { p_user_id: a, p_server_id: serverId });
    assert.equal(view.bio, 'Loves trekking');
    assert.equal(view.professional_bio, 'Backend engineer');
    assert.equal(view.occupation, 'Engineer');
  });

  test('preview_my_profile shows what any member sees and respects per-field privacy', async () => {
    const a = await makeUser();
    await as(a, `update public.profiles set bio = 'Hi', instagram_handle = 'abc_123' where id = auth.uid()`);
    let preview = await rpc(a, 'preview_my_profile');
    assert.equal(preview.bio, 'Hi');
    assert.equal(preview.instagram_handle, null, 'socials default to connections-only');
    assert.equal(preview.socials_hidden, true);
    assert.equal(preview.relationship.state, 'none');
    await as(a, `update public.user_settings set socials_visibility = 'members', bio_visibility = 'only_me' where user_id = auth.uid()`);
    preview = await rpc(a, 'preview_my_profile');
    assert.equal(preview.instagram_handle, 'abc_123');
    assert.equal(preview.bio, null);
  });

  test('up to six extra photos; a freed slot is reused; viewers in a shared Server can read them', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    await makeServer(owner, [a, b]);
    const ids = [];
    for (let i = 0; i < 6; i++) {
      const path = `${a}/p${i}.jpg`;
      await uploadObject(a, 'profile-photos', path);
      ids.push(await rpc(a, 'add_profile_photo', { p_path: path, p_position: 1 }));
    }
    await uploadObject(a, 'profile-photos', `${a}/p6.jpg`);
    await rejects(rpc(a, 'add_profile_photo', { p_path: `${a}/p6.jpg`, p_position: 7 }), 'too_many_photos');
    await rpc(a, 'remove_profile_photo', { p_photo_id: ids[2] });
    await rpc(a, 'add_profile_photo', { p_path: `${a}/p6.jpg`, p_position: 6 });
    const [{ position }] = await admin(`select position from public.profile_photos where storage_path = $1`, [`${a}/p6.jpg`]);
    assert.equal(position, 3, 'the freed slot is reused');
    await rejects(rpc(a, 'add_profile_photo', { p_path: `${b}/x.jpg`, p_position: 1 }), 'invalid_photo');
    const readable = await as(b, `select name from storage.objects where bucket_id = 'profile-photos' and name = $1`, [`${a}/p0.jpg`]);
    assert.equal(readable.length, 1, 'a member of a shared Server can load the photo');
    const stranger = await makeUser();
    const hidden = await as(stranger, `select name from storage.objects where bucket_id = 'profile-photos' and name = $1`, [`${a}/p0.jpg`]);
    assert.equal(hidden.length, 0, 'strangers cannot');
  });
});

describe('§10 activity posts with multiple images', () => {
  test('create with 3 images, list them in order, then reorder and remove without key conflicts', async () => {
    const owner = await makeUser();
    const m = await makeUser();
    const { serverId } = await makeServer(owner, [m]);
    const paths = [0, 1, 2].map((i) => `${serverId}/img${i}.jpg`);
    for (const p of paths) await uploadObject(owner, 'activity-media', p);
    const postId = await rpc(owner, 'create_activity_with_images', {
      p_server_id: serverId, p_body: 'Football at 6', p_category: 'sports', p_expires_hours: 24, p_capacity: 10, p_image_paths: paths,
    });
    let images = await rpcRows(m, 'get_activity_images', { p_post_ids: [postId] });
    assert.deepEqual(images.map((i) => i.storage_path), paths);
    const reordered = [paths[2], paths[0], paths[1]];
    await rpc(owner, 'update_activity_with_images', {
      p_post_id: postId, p_body: 'Football at 6', p_category: 'sports', p_expires_hours: 24, p_capacity: 10, p_image_paths: reordered,
    });
    images = await rpcRows(m, 'get_activity_images', { p_post_ids: [postId] });
    assert.deepEqual(images.map((i) => i.storage_path), reordered);
    const claimed = (await admin(`select * from public.claim_storage_deletions(500)`)).map((r) => r.path);
    for (const p of reordered) assert.ok(!claimed.includes(p), `still-referenced ${p} must not be deleted`);
    await admin(`update app_private.storage_deletions set status = 'pending', lease_until = null where status = 'leased'`);
    await rpc(owner, 'update_activity_with_images', {
      p_post_id: postId, p_body: 'Football at 6', p_category: 'sports', p_expires_hours: 24, p_capacity: 10, p_image_paths: [paths[1]],
    });
    images = await rpcRows(m, 'get_activity_images', { p_post_ids: [postId] });
    assert.deepEqual(images.map((i) => i.storage_path), [paths[1]]);
    const page = await rpcRows(m, 'list_activity_page', { p_server_id: null, p_before: null, p_before_id: null, p_limit: 20, p_sort: 'latest', p_offset: 0 });
    assert.ok(page.some((p) => p.id === postId));
    const outsider = await makeUser();
    assert.equal((await rpcRows(outsider, 'get_activity_images', { p_post_ids: [postId] })).length, 0);
  });
});

describe('V3.1 review fixes', () => {
  test('temporary-Server directory lists only people Open to Talk; ended venues return no people instead of failing', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { serverId, token } = await makeServer(owner, [], { kind: 'short_term', ends_at: soon(2), category: 'event' });
    await rpc(a, 'join_server_with_preferences', { p_token: token, p_mode: 'both', p_open: true, p_minutes: 60 });
    await rpc(b, 'join_server_with_preferences', { p_token: token, p_mode: 'both', p_open: false });
    const dir = (await rpcRows(a, 'server_directory', { p_server_id: serverId })).map((d) => d.user_id);
    assert.ok(dir.includes(owner) && dir.includes(a));
    assert.ok(!dir.includes(b), 'someone who declined Open to Talk is not listed as present');
    const people = await rpcRows(b, 'venue_people', { p_server_id: serverId });
    assert.ok(Array.isArray(people[0].interests));
    await admin(`update public.servers set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute' where id = $1`, [serverId]);
    assert.deepEqual(await rpcRows(b, 'venue_people', { p_server_id: serverId }), []);
  });

  test('only admins create invites; zoomed-out Hot Map returns nothing; long profile text saves', async () => {
    const owner = await makeUser();
    const mod = await makeUser();
    const { serverId } = await makeServer(owner, [mod]);
    await rpc(owner, 'set_member_role', { p_server_id: serverId, p_user_id: mod, p_role: 'moderator' });
    await rejects(as(mod, `select * from public.create_join_token($1, 'code')`, [serverId]), 'forbidden');
    assert.deepEqual(await rpcRows(owner, 'venue_hot_map', { p_min_lat: -60, p_min_lng: -170, p_max_lat: 70, p_max_lng: 170 }), []);
    await as(owner, `update public.profiles set professional_bio = repeat('a', 500), social_preferences = repeat('b', 300) where id = auth.uid()`);
    const preview = await rpc(owner, 'preview_join_token', { p_token: (await as(owner, `select * from public.create_join_token($1, 'code')`, [serverId]))[0].token });
    assert.ok('member_field_label' in preview);
  });
});
