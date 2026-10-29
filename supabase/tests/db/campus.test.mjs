import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { admin, as, makeServer, makeUser, pool, rejects, rpc, rpcRows } from './helpers.mjs';

describe('verified Spotify link storage', () => {
  test('only service role can link, users can disconnect, and one Spotify account cannot be shared', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const url = 'https://open.spotify.com/user/account123';
    await assert.rejects(rpc(a, 'save_spotify_connection', {
      p_user_id: a, p_account_id: 'account123', p_profile_url: url, p_display_name: 'Tester',
    }), /permission denied/);
    await admin('select public.save_spotify_connection($1,$2,$3,$4)', [a, 'account123', url, 'Tester']);
    assert.equal((await admin('select spotify_url from public.profiles where id=$1', [a]))[0].spotify_url, url);
    await assert.rejects(as(a, 'update public.profiles set spotify_url=null where id=auth.uid()'), /permission denied/);
    await assert.rejects(admin('select public.save_spotify_connection($1,$2,$3,$4)', [b, 'account123', url, 'Other']), /duplicate key/);
    await rpc(a, 'disconnect_spotify');
    assert.equal((await admin('select spotify_url from public.profiles where id=$1', [a]))[0].spotify_url, null);
  });
});

describe('paged conversations and lightweight badges', () => {
  test('connections remain reachable past 500 rows with equal timestamps', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const peers = await admin(`insert into auth.users(email,raw_user_meta_data,email_confirmed_at)
      select 'friend-' || gen_random_uuid() || '@test.local',
        jsonb_build_object('display_name','Connection peer'),now()
      from generate_series(1,505) returning id`);
    await admin(`insert into public.connections(user_a,user_b,status,a_saved,b_saved,created_at)
      select least($1::uuid,p.id),greatest($1::uuid,p.id),'active',p.ordinality<=3,p.ordinality<=3,
        '2026-01-01T00:00:00Z'::timestamptz
      from unnest($2::uuid[]) with ordinality as p(id,ordinality)`, [owner, peers.map((p) => p.id)]);

    const seen = new Set();
    let cursor = { p_before_at: null, p_before_id: null, p_snapshot_at: null, p_limit: 30 };
    for (let page = 0; page < 18; page++) {
      const rows = await rpcRows(owner, 'list_connections_page', { p_friends_only: false, ...cursor });
      if (!rows.length) break;
      for (const row of rows) {
        assert.ok(!seen.has(row.connection_id), 'cursor must not repeat a connection');
        seen.add(row.connection_id);
      }
      cursor = { p_before_at: rows.at(-1).cursor_at,
        p_before_id: rows.at(-1).connection_id,p_snapshot_at: rows[0].snapshot_at,p_limit: 30 };
    }
    assert.equal(seen.size, 505);
    assert.equal((await rpcRows(owner, 'list_connections_page', { p_friends_only: true })).length, 3);
    assert.equal((await rpcRows(outsider, 'list_connections_page')).length, 0);
  });

  test('request inbox reaches beyond 100 equal-timestamp rows with a stable cursor', async () => {
    const owner = await makeUser();
    const peers = await admin(`insert into auth.users(email,raw_user_meta_data,email_confirmed_at)
      select 'req-'||gen_random_uuid()||'@test.local','{"display_name":"Requester"}'::jsonb,now()
      from generate_series(1,105) returning id`);
    await admin(`insert into public.connection_requests(sender_id,recipient_id,status)
      select id,$1,'pending' from unnest($2::uuid[]) p(id)`, [owner, peers.map((p) => p.id)]);
    const seen = new Set();
    let cursor = { p_before_at: null, p_before_id: null, p_snapshot_at: null, p_limit: 30 };
    for (let page = 0; page < 5; page++) {
      const rows = await rpcRows(owner, 'list_requests_page', { p_direction: 'incoming', ...cursor });
      if (!rows.length) break;
      rows.forEach((row) => { assert.ok(!seen.has(row.id)); seen.add(row.id); });
      cursor = { p_before_at: rows.at(-1).cursor_at,p_before_id: rows.at(-1).id,
        p_snapshot_at: rows[0].snapshot_at,p_limit: 30 };
    }
    assert.equal(seen.size, 105);
    assert.equal(await rpc(owner, 'get_pending_request_count', { p_direction: 'incoming' }), 99);
  });

  test('an owner can reach chats beyond 200 with equal timestamps and no duplicate cursor rows', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const peers = await admin(`insert into auth.users(email,raw_user_meta_data,email_confirmed_at)
      select 'inbox-' || gen_random_uuid() || '@test.local', jsonb_build_object('display_name','Inbox peer'), now()
      from generate_series(1,205) returning id`);
    const connections = await admin(`insert into public.connections(user_a,user_b,status)
      select least($1::uuid,p.id),greatest($1::uuid,p.id),'active'
      from unnest($2::uuid[]) p(id) returning id,user_a,user_b`, [owner, peers.map((p) => p.id)]);
    const ids = connections.map((c) => c.id);
    const conversations = await admin(`insert into public.conversations(connection_id)
      select id from public.connections where id=any($1::uuid[]) returning id,connection_id`, [ids]);
    await admin(`insert into public.conversation_participants(conversation_id,user_id)
      select cv.id,c.user_a from public.conversations cv join public.connections c on c.id=cv.connection_id
      where c.id=any($1::uuid[])
      union all
      select cv.id,c.user_b from public.conversations cv join public.connections c on c.id=cv.connection_id
      where c.id=any($1::uuid[])`, [ids]);

    const seen = new Set();
    let beforeAt = null;
    let beforeId = null;
    let snapshotAt = null;
    for (let page = 0; page < 8; page++) {
      const rows = await rpcRows(owner, 'list_conversations_page', {
        p_before_at: beforeAt, p_before_id: beforeId, p_snapshot_at: snapshotAt, p_limit: 30,
      });
      if (!rows.length) break;
      for (const row of rows) {
        assert.ok(!seen.has(row.conversation_id), 'cursor must not repeat rows');
        seen.add(row.conversation_id);
      }
      snapshotAt = rows[0].snapshot_at;
      beforeAt = rows.at(-1).cursor_at;
      beforeId = rows.at(-1).conversation_id;
    }
    assert.equal(seen.size, 205);
    assert.equal((await rpcRows(outsider, 'list_conversations_page')).length, 0);

    const cv = conversations[0];
    const connection = connections.find((c) => c.id === cv.connection_id);
    const peer = connection.user_a === owner ? connection.user_b : connection.user_a;
    await as(peer, `insert into public.messages(conversation_id,sender_id,client_id,body)
      values($1,auth.uid(),gen_random_uuid(),'hello')`, [cv.id]);
    assert.equal(await rpc(owner, 'get_chat_badge_count'), 1);
    await rpc(owner, 'mark_conversation_read', { p_conversation_id: cv.id });
    assert.equal(await rpc(owner, 'get_chat_badge_count'), 0);
  });
});

describe('campus media lifecycle', () => {
  test('profile and activity thumbnail companions attach and drain with their originals', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { serverId } = await makeServer(owner, [other]);
    const profilePaths = [`${owner}/photo.jpg`, `${owner}/photo-thumb.jpg`];
    const activityPaths = [`${serverId}/plan.jpg`, `${serverId}/plan-thumb.jpg`];
    for (const path of profilePaths) {
      await rpc(owner, 'reserve_media_upload', { p_bucket: 'profile-photos', p_path: path, p_bytes: 200 });
      await as(owner, `insert into storage.objects(bucket_id,name,owner,metadata)
        values('profile-photos',$1,auth.uid(),'{"size":200}')`, [path]);
    }
    const photoId = await rpc(owner, 'add_profile_photo', { p_path: profilePaths[0], p_position: 1 });
    await rpc(owner, 'finalize_media_upload', { p_bucket: 'profile-photos', p_path: profilePaths[1] });
    assert.equal((await admin(`select app_private.media_reference_exists('profile-photos',$1) linked`, [profilePaths[1]]))[0].linked, true);
    await rpc(owner, 'remove_profile_photo', { p_photo_id: photoId });
    assert.deepEqual((await admin(`select path from app_private.storage_deletions
      where bucket='profile-photos' and path=any($1::text[]) order by path`, [profilePaths])).map((r) => r.path), profilePaths.sort());

    for (const path of activityPaths) {
      await rpc(owner, 'reserve_media_upload', { p_bucket: 'activity-media', p_path: path, p_bytes: 300 });
      await as(owner, `insert into storage.objects(bucket_id,name,owner,metadata)
        values('activity-media',$1,auth.uid(),'{"size":300}')`, [path]);
    }
    const postId = await rpc(owner, 'create_activity_with_images', { p_server_id: serverId,
      p_body: 'Coffee at the student union', p_image_paths: [activityPaths[0]] });
    await rpc(owner, 'finalize_media_upload', { p_bucket: 'activity-media', p_path: activityPaths[1] });
    assert.equal((await admin(`select app_private.media_reference_exists('activity-media',$1) linked`, [activityPaths[1]]))[0].linked, true);
    await rpc(owner, 'delete_activity_post', { p_post_id: postId });
    assert.deepEqual((await admin(`select path from app_private.storage_deletions
      where bucket='activity-media' and path=any($1::text[]) order by path`, [activityPaths])).map((r) => r.path), activityPaths.sort());
  });

  test('a reservation is scoped and orphaned uploads are recovered without deleting attached media', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const orphan = `${a}/orphan.jpg`;
    const attached = `${a}/attached.jpg`;
    await rejects(rpc(b, 'reserve_media_upload', { p_bucket: 'avatars', p_path: orphan, p_bytes: 100 }), 'forbidden');
    await assert.rejects(as(a, `insert into storage.objects(bucket_id,name,owner) values('avatars',$1,auth.uid())`, [orphan]), /row-level security/);
    await rpc(a, 'reserve_media_upload', { p_bucket: 'avatars', p_path: orphan, p_bytes: 100 });
    await as(a, `insert into storage.objects(bucket_id,name,owner,metadata) values('avatars',$1,auth.uid(),'{"size":100}')`, [orphan]);
    await rpc(a, 'reserve_media_upload', { p_bucket: 'avatars', p_path: attached, p_bytes: 100 });
    await as(a, `insert into storage.objects(bucket_id,name,owner,metadata) values('avatars',$1,auth.uid(),'{"size":100}')`, [attached]);
    await as(a, `update public.profiles set avatar_path=$1 where id=auth.uid()`, [attached]);
    await admin(`update app_private.media_uploads set created_at=now()-interval '3 hours' where owner_id=$1`, [a]);
    assert.equal((await admin(`select public.sweep_orphan_media(20) n`))[0].n, 2);
    const rows = await admin(`select path,status from app_private.media_uploads where owner_id=$1 order by path`, [a]);
    assert.deepEqual(rows.map((r) => [r.path, r.status]), [[attached, 'attached'], [orphan, 'abandoned']]);
    assert.equal((await admin(`select count(*)::int n from app_private.storage_deletions where bucket='avatars' and path=$1`, [orphan]))[0].n, 1);
    assert.equal((await admin(`select count(*)::int n from app_private.storage_deletions where bucket='avatars' and path=$1`, [attached]))[0].n, 0);
    await rpc(a, 'finalize_media_upload', { p_bucket: 'avatars', p_path: attached });
    await rejects(rpc(a, 'finalize_media_upload', { p_bucket: 'avatars', p_path: orphan }), 'invalid_media');
    await rejects(rpc(b, 'finalize_media_upload', { p_bucket: 'avatars', p_path: attached }), 'invalid_media');
  });

  test('deletion failures back off and can be reclaimed after the lease', async () => {
    const a = await makeUser();
    const path = `${a}/retry.jpg`;
    const [{ id }] = await admin(`insert into app_private.storage_deletions(bucket,path) values('avatars',$1) returning id`, [path]);
    await admin(`update app_private.storage_deletions set next_attempt_at=now()-interval '1 day' where id=$1`, [id]);
    const claim = await admin(`select * from public.claim_storage_deletions(1)`);
    assert.equal(claim[0].id, id);
    assert.ok(!(await admin(`select * from public.claim_storage_deletions(20)`)).some((r) => r.id === id));
    await admin(`select public.fail_storage_deletions(array[$1::bigint],'storage_down')`, [id]);
    assert.ok(!(await admin(`select * from public.claim_storage_deletions(20)`)).some((r) => r.id === id));
    await admin(`update app_private.storage_deletions set next_attempt_at=now()-interval '1 second' where id=$1`, [id]);
    assert.equal((await admin(`select * from public.claim_storage_deletions(1)`))[0].id, id);
    await admin(`select public.complete_storage_deletions(array[$1::bigint])`, [id]);
    assert.equal((await admin(`select count(*)::int n from app_private.storage_deletions where id=$1`, [id]))[0].n, 0);
    await assert.rejects(as(a, 'select * from public.claim_storage_deletions(1)'), /permission denied/);
  });
});

describe('private feedback', () => {
  test('submissions are categorized and screenshots are readable only by owner or platform admin', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const path = `${owner}/screenshot.jpg`;
    await rpc(owner, 'reserve_media_upload', { p_bucket: 'feedback-media', p_path: path, p_bytes: 400 });
    await as(owner, `insert into storage.objects(bucket_id,name,owner,metadata)
      values('feedback-media',$1,auth.uid(),'{"size":400}')`, [path]);
    const id = await rpc(owner, 'submit_feedback', { p_category: 'bug', p_body: 'The join link did not open.', p_screenshot_path: path });
    await rpc(owner, 'finalize_media_upload', { p_bucket: 'feedback-media', p_path: path });
    const [row] = await admin('select category,screenshot_path from app_private.feedback_submissions where id=$1', [id]);
    assert.deepEqual([row.category, row.screenshot_path], ['bug', path]);
    assert.equal((await as(owner, `select count(*)::int n from storage.objects where bucket_id='feedback-media' and name=$1`, [path]))[0].n, 1);
    assert.equal((await as(outsider, `select count(*)::int n from storage.objects where bucket_id='feedback-media' and name=$1`, [path]))[0].n, 0);
    await assert.rejects(as(outsider, 'select * from app_private.feedback_submissions'), /permission denied/);
    await rejects(rpc(owner, 'submit_feedback', { p_category: 'bug', p_body: 'short' }), 'invalid_feedback');
  });
});

describe('durable push jobs', () => {
  test('claims once, tracks accepted tickets per device and reclaims a crashed lease', async () => {
    const user = await makeUser();
    const [{ id: tokenId }] = await admin(`insert into public.push_tokens(user_id,token,platform)
      values($1,$2,'android') returning id`, [user, `ExponentPushToken[test-${user}]`]);
    const [{ id: noteId }] = await admin(`insert into public.notifications(user_id,type,title)
      values($1,'connection_request','A new request') returning id`, [user]);
    await admin(`update app_private.push_jobs set next_attempt_at=now()-interval '1 day' where notification_id=$1`, [noteId]);
    const [job] = await admin(`select * from public.claim_push_jobs(1)`);
    assert.equal(job.notification_id, noteId);
    assert.ok(!(await admin(`select * from public.claim_push_jobs(30)`)).some((r) => r.notification_id === noteId));
    assert.deepEqual((await admin(`select * from public.pending_push_devices($1,$2)`, [noteId, job.lease_id])).map((r) => r.token_id), [tokenId]);
    await admin(`select public.finish_push_job($1,$2,$3::jsonb,null)`, [noteId, job.lease_id,
      JSON.stringify([{ token_id: tokenId, status: 'accepted', ticket_id: `ticket-${noteId}` }])]);
    assert.equal((await admin(`select status from app_private.push_jobs where notification_id=$1`, [noteId]))[0].status, 'completed');
    assert.ok((await admin(`select pushed_at from public.notifications where id=$1`, [noteId]))[0].pushed_at);
    await admin(`update app_private.push_jobs set status='leased',lease_until=now()-interval '1 second',lease_id=gen_random_uuid()
      where notification_id=$1`, [noteId]);
    const [reclaimed] = await admin(`select * from public.claim_push_jobs(1)`);
    assert.equal(reclaimed.notification_id, noteId);
    assert.equal((await admin(`select count(*)::int n from public.pending_push_devices($1,$2)`, [noteId, reclaimed.lease_id]))[0].n, 0);
    await admin(`select public.finish_push_job($1,$2,'[]'::jsonb,null)`, [noteId, reclaimed.lease_id]);
    await assert.rejects(as(user, 'select * from public.claim_push_jobs(1)'), /permission denied/);
  });

  test('retry/backoff persists after a transient provider error', async () => {
    const user = await makeUser();
    const [{ id: noteId }] = await admin(`insert into public.notifications(user_id,type,title)
      values($1,'badge_granted','Badge') returning id`, [user]);
    await admin(`update app_private.push_jobs set next_attempt_at=now()-interval '1 day' where notification_id=$1`, [noteId]);
    const [job] = await admin(`select * from public.claim_push_jobs(1)`);
    assert.equal(job.notification_id, noteId);
    await admin(`select public.finish_push_job($1,$2,'[]'::jsonb,'http_429')`, [noteId, job.lease_id]);
    const [queued] = await admin(`select status,attempts,next_attempt_at from app_private.push_jobs where notification_id=$1`, [noteId]);
    assert.equal(queued.status, 'pending');
    assert.equal(queued.attempts, 1);
    assert.ok(new Date(queued.next_attempt_at).getTime() > Date.now());
  });
});

describe('campus context and engagement', () => {
  test('optimized activity page keeps membership, block and response rules', async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const outsider = await makeUser();
    const { serverId } = await makeServer(owner, [viewer]);
    const ownPost = await rpc(viewer, 'create_activity_post', { p_server_id: serverId, p_body: 'Study table in the library' });
    const otherPost = await rpc(owner, 'create_activity_post', { p_server_id: serverId, p_body: 'Coffee after class today' });
    assert.deepEqual((await rpcRows(viewer, 'list_activity_page')).map((p) => p.id), [otherPost]);
    assert.deepEqual((await rpcRows(viewer, 'list_activity_page', { p_sort: 'mine' })).map((p) => p.id), [ownPost]);
    assert.equal((await rpcRows(outsider, 'list_activity_page')).length, 0);
    await rpc(viewer, 'set_post_response', { p_post_id: otherPost, p_kind: 'in' });
    const [post] = await rpcRows(viewer, 'list_activity_page', { p_server_id: serverId });
    assert.equal(post.id, otherPost);
    assert.equal(Number(post.response_count), 1);
    assert.equal(Number(post.in_count), 1);
    assert.equal(post.my_response, 'in');
    await rpc(viewer, 'block_user', { p_user_id: owner });
    assert.deepEqual((await rpcRows(viewer, 'list_activity_page')).map((p) => p.id), []);
    assert.deepEqual((await rpcRows(viewer, 'list_activity_page', { p_sort: 'mine' })).map((p) => p.id), [ownPost]);
  });

  test('on-site people expire and Hot Map suppresses fewer than three active sessions', async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const p1 = await makeUser();
    const p2 = await makeUser();
    const { serverId } = await makeServer(owner, [viewer, p1, p2], {
      kind: 'short_term', ends_at: new Date(Date.now()+4*3600_000).toISOString(), visibility: 'listed', name: 'Campus Cafe',
    });
    await as(owner, 'update public.servers set venue_lat=26.5,venue_lng=80.2 where id=$1', [serverId]);
    for (const user of [owner, p1]) await rpc(user, 'set_venue_session', {
      p_server_id: serverId, p_open: true, p_minutes: 31, p_topic: 'Coffee', p_location_hint: 'Near the door', p_mode: 'personal',
    });
    const box = { p_min_lat: 26.4, p_min_lng: 80.1, p_max_lat: 26.6, p_max_lng: 80.3 };
    assert.equal((await rpcRows(viewer, 'venue_hot_map', box)).length, 0);
    await rpc(p2, 'set_venue_session', {
      p_server_id: serverId, p_open: false, p_minutes: 31, p_mode: 'professional',
    });
    assert.equal((await rpcRows(viewer, 'venue_hot_map', box)).length, 1);
    assert.equal((await rpcRows(viewer, 'venue_people', { p_server_id: serverId })).length, 2);
    await admin(`update public.venue_sessions set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour'
      where server_id=$1 and user_id=$2`, [serverId, p1]);
    assert.equal((await rpcRows(viewer, 'venue_people', { p_server_id: serverId })).length, 1);
    assert.equal((await rpcRows(viewer, 'venue_hot_map', box)).length, 0);
    await admin('update public.servers set is_archived=true where id=$1', [serverId]);
  });

  test('daily summaries follow posts, visits and membership changes', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const { serverId } = await makeServer(owner, [member], { visibility: 'listed' });
    const total = async (col) => (await admin(`select coalesce(sum(${col}),0)::int n from app_private.server_engagement_daily where server_id=$1`, [serverId]))[0].n;
    assert.equal(await total('joins'), 2);
    const post = await rpc(owner, 'create_activity_post', { p_server_id: serverId, p_body: 'Lunch at the student centre' });
    assert.equal(await total('posts'), 1);
    await rpc(member, 'record_server_visit', { p_server_id: serverId });
    assert.equal(await total('visits'), 1);
    await admin(`delete from public.activity_posts where id=$1`, [post]);
    assert.equal(await total('posts'), 0);
    await admin('update public.servers set is_archived=true where id=$1', [serverId]);
  });
});

after(async () => pool.end());
