import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';

import { admin, as, makeServer, makeUser, rejects, rpc, rpcRows } from './helpers.mjs';

describe('Server chat media and settings permissions', () => {
  test('only the Server team posts, members alone read private media, and closed Servers are read-only', async () => {
    const owner = await makeUser();
    const moderator = await makeUser();
    const member = await makeUser();
    const outsider = await makeUser();
    const { serverId } = await makeServer(owner, [moderator, member], {
      kind: 'short_term', ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await rpc(owner, 'set_member_role', { p_server_id: serverId, p_user_id: moderator, p_role: 'moderator' });

    await rejects(rpc(member, 'post_server_message', {
      p_server_id: serverId, p_kind: 'text', p_body: 'Members cannot post',
    }), 'forbidden');
    const first = await rpc(owner, 'post_server_message', {
      p_server_id: serverId, p_kind: 'text', p_body: 'Doors open at seven',
    });
    assert.ok(first);

    const path = `${serverId}/${randomUUID()}.jpg`;
    await rpc(moderator, 'reserve_media_upload', { p_bucket: 'server-media', p_path: path, p_bytes: 1000 });
    await as(moderator, `insert into storage.objects(bucket_id,name,owner,metadata)
      values('server-media',$1,$2,'{"size":1000}')`, [path, moderator]);
    const photo = await rpc(moderator, 'post_server_message', {
      p_server_id: serverId, p_kind: 'image', p_media_path: path,
      p_media_mime: 'image/jpeg', p_media_size: 1000,
    });
    await rpc(moderator, 'finalize_media_upload', { p_bucket: 'server-media', p_path: path });

    const visible = await rpcRows(member, 'list_server_messages', { p_server_id: serverId });
    assert.deepEqual(new Set(visible.map((m) => m.id)), new Set([first, photo]));
    assert.equal(visible.find((m) => m.id === photo).media_path, path);
    assert.equal((await as(member, `select name from storage.objects where bucket_id='server-media' and name=$1`, [path])).length, 1);
    assert.equal((await as(outsider, `select name from storage.objects where bucket_id='server-media' and name=$1`, [path])).length, 0);
    await rejects(rpcRows(outsider, 'list_server_messages', { p_server_id: serverId }), 'forbidden');
    await rejects(rpc(member, 'reserve_media_upload', { p_bucket: 'server-media', p_path: `${serverId}/${randomUUID()}.jpg`, p_bytes: 1000 }), 'forbidden');

    await admin('update public.servers set is_archived=true where id=$1', [serverId]);
    await rejects(rpc(owner, 'post_server_message', {
      p_server_id: serverId, p_kind: 'text', p_body: 'Should not send',
    }), 'server_closed');
    assert.equal((await rpcRows(member, 'list_server_messages', { p_server_id: serverId })).length, 2);
  });

  test('temporary Server pictures are admin-editable and message cursors do not repeat rows', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const { serverId } = await makeServer(owner, [member], {
      kind: 'short_term', ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const avatar = `${serverId}/${randomUUID()}.jpg`;
    assert.equal((await as(member, 'update public.servers set avatar_path=$1 where id=$2 returning id', [avatar, serverId])).length, 0);
    assert.equal((await as(owner, 'update public.servers set avatar_path=$1 where id=$2 returning id', [avatar, serverId])).length, 1);
    assert.equal((await rpc(member, 'get_server', { p_server_id: serverId })).avatar_path, avatar);
    assert.equal((await as(owner, 'update public.servers set avatar_path=null where id=$1 returning id', [serverId])).length, 1);

    await admin(`insert into public.server_announcements(server_id,author_id,title,body,created_at)
      select $1,$2,'Update', 'Message ' || n, now() from generate_series(1,45) n`, [serverId, owner]);
    const firstPage = await rpcRows(member, 'list_server_messages', { p_server_id: serverId });
    assert.equal(firstPage.length, 40);
    const oldest = firstPage.at(-1);
    // node-postgres turns timestamptz into millisecond Date objects; PostgREST keeps microseconds in JSON.
    const [{ created_at: cursorTime }] = await admin(
      'select created_at::text from public.server_announcements where id=$1', [oldest.id]);
    const secondPage = await rpcRows(member, 'list_server_messages', {
      p_server_id: serverId, p_before_created: cursorTime,
      p_before_id: oldest.id, p_limit: 40,
    });
    assert.equal(secondPage.length, 5);
    assert.equal(new Set([...firstPage, ...secondPage].map((m) => m.id)).size, 45);
  });
});
