// The end-to-end acceptance scenario from the build brief (§25/§28), executed against real RLS + RPCs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { admin, as, goAvailable, makeServer, makeUser, pool, rejects, rpc, rpcRows } from './helpers.mjs';

after(() => pool.end());

describe('core flow: server → join → availability → discovery → request → chat', () => {
  let A, B, C, serverId, token, requestId, conversationId;

  test('setup: three real accounts with interests', async () => {
    A = await makeUser({ name: 'Aarav', tags: { interest: ['Machine Learning', 'Badminton'], language: ['English'] } });
    B = await makeUser({ name: 'Bhavna', tags: { interest: ['machine learning', 'Photography'], hobby: ['Badminton'] } });
    C = await makeUser({ name: 'Chirag', tags: { interest: ['Cricket'] } });
  });

  test('Account A creates a Server and a QR join token', async () => {
    ({ serverId, token } = await makeServer(A, [], { name: 'IITK Hall 4' }));
    assert.ok(serverId);
    assert.ok(token.length >= 20);
    const s = await rpc(A, 'get_server', { p_server_id: serverId });
    assert.equal(s.membership.role, 'admin');
  });

  test('unrelated account C cannot see an unlisted Server without the token', async () => {
    await rejects(rpc(C, 'get_server', { p_server_id: serverId }), 'not_found');
    const rows = await as(C, 'select id from public.servers where id = $1', [serverId]);
    assert.equal(rows.length, 0);
  });

  test('a forged/garbage token is rejected by the backend', async () => {
    assert.equal((await rpc(B, 'join_server_with_token', { p_token: 'not-a-real-token-0000000' })).status, 'invalid');
  });

  test('Account B previews then joins through the invitation (full URL accepted)', async () => {
    const preview = await rpc(B, 'preview_join_token', { p_token: token });
    assert.equal(preview.name, 'IITK Hall 4');
    const res = await rpc(B, 'join_server_with_token', { p_token: `https://sniff.in/join?t=${token}` });
    assert.equal(res.status, 'active');
  });

  test('B is NOT recommended until B turns on Open to Talk (default OFF)', async () => {
    await goAvailable(A);
    const rows = await rpcRows(A, 'discover_people', { p_server_id: serverId });
    assert.equal(rows.length, 0);
  });

  test('people recommendations require the viewer to be Open to Talk (reciprocity)', async () => {
    await rpc(A, 'set_open_to_talk', { p_open: false });
    await rejects(rpcRows(A, 'discover_people', { p_server_id: serverId }), 'not_open_to_talk');
    await rejects(rpcRows(A, 'talk_matches'), 'not_open_to_talk');
    await goAvailable(A);
  });

  test('B turns on Open to Talk → A discovers B with real shared-interest reasons', async () => {
    await goAvailable(B);
    const rows = await rpcRows(A, 'discover_people', { p_server_id: serverId });
    assert.equal(rows.length, 1);
    const [b] = rows;
    assert.equal(b.user_id, B);
    assert.ok(b.shared_tags.map((t) => t.toLowerCase()).includes('machine learning'));
    assert.ok(b.shared_tags.includes('Badminton'), 'same name matches across interest and hobby');
    assert.ok(b.reasons[0].startsWith('You both like'));
    assert.ok(Number(b.score) > 0);
  });

  test('C (not a member) cannot run discovery on the Server', async () => {
    await goAvailable(C);
    await rejects(rpcRows(C, 'discover_people', { p_server_id: serverId }), 'forbidden');
  });

  test('A sends a connection request with an intro; duplicates are prevented', async () => {
    const res = await rpc(A, 'send_connection_request', { p_recipient: B, p_server_id: serverId, p_message: 'Hi! ML + badminton?' });
    assert.equal(res.status, 'pending');
    requestId = res.request_id;
    await rejects(rpc(A, 'send_connection_request', { p_recipient: B, p_server_id: serverId }), 'already_requested');
    const notes = await as(B, `select type, body from public.notifications where request_id = $1`, [requestId]);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].type, 'connection_request');
  });

  test('C cannot accept, read or cancel a request between A and B', async () => {
    await rejects(rpc(C, 'respond_to_request', { p_request_id: requestId, p_accept: true }), 'not_found');
    const rows = await as(C, 'select id from public.connection_requests where id = $1', [requestId]);
    assert.equal(rows.length, 0);
    await rejects(rpc(C, 'cancel_request', { p_request_id: requestId }), 'not_found');
  });

  test('before acceptance: no chat, and hidden social links stay hidden', async () => {
    await as(B, `update public.profiles set instagram_handle = 'bhavna.clicks' where id = auth.uid()`);
    const card = await rpc(A, 'get_profile', { p_user_id: B });
    assert.equal(card.instagram_handle, null);
    assert.equal(card.socials_hidden, true);
    assert.equal(card.relationship.state, 'pending_outgoing');
  });

  test('B accepts → a private conversation opens for both', async () => {
    const res = await rpc(B, 'respond_to_request', { p_request_id: requestId, p_accept: true });
    assert.equal(res.status, 'accepted');
    conversationId = res.conversation_id;
    assert.ok(conversationId);
    await rejects(rpc(B, 'respond_to_request', { p_request_id: requestId, p_accept: true }), 'invalid_transition');
    const convA = await rpcRows(A, 'list_conversations');
    const convB = await rpcRows(B, 'list_conversations');
    assert.equal(convA[0].conversation_id, conversationId);
    assert.equal(convB[0].conversation_id, conversationId);
  });

  test('after acceptance the connections-only fields are revealed', async () => {
    const card = await rpc(A, 'get_profile', { p_user_id: B });
    assert.equal(card.instagram_handle, 'bhavna.clicks');
    assert.equal(card.relationship.state, 'connected');
  });

  test('messages are delivered to the other participant', async () => {
    const clientId = randomUUID();
    await as(A, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, auth.uid(), $2, 'Hey Bhavna!')`, [conversationId, clientId]);
    const rows = await as(B, 'select body, sender_id from public.messages where conversation_id = $1', [conversationId]);
    assert.deepEqual(new Set(rows.map((r) => r.body)), new Set(['Hi! ML + badminton?', 'Hey Bhavna!']));
    const [conv] = await rpcRows(B, 'list_conversations');
    assert.equal(Number(conv.unread_count), 2);
    await rpc(B, 'mark_conversation_read', { p_conversation_id: conversationId });
    const [conv2] = await rpcRows(B, 'list_conversations');
    assert.equal(Number(conv2.unread_count), 0);
    // Retrying with the same client id is idempotent at the DB level (unique violation, no duplicate).
    await assert.rejects(as(A, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, auth.uid(), $2, 'Hey Bhavna!')`, [conversationId, clientId]));
  });

  test('the message notification never contains the message body', async () => {
    const rows = await as(B, `select title, body from public.notifications where conversation_id = $1 and type = 'message'`, [conversationId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body, null);
    assert.ok(!rows[0].title.includes('Hey Bhavna'));
  });

  test('unrelated account C is denied the conversation (read, write, spoof)', async () => {
    assert.equal((await as(C, 'select * from public.messages where conversation_id = $1', [conversationId])).length, 0);
    assert.equal((await as(C, 'select * from public.conversations where id = $1', [conversationId])).length, 0);
    await assert.rejects(
      as(C, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, auth.uid(), gen_random_uuid(), 'intrude')`, [conversationId]),
      /row-level security/,
    );
    await assert.rejects(
      as(C, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, $2, gen_random_uuid(), 'spoof')`, [conversationId, A]),
      /row-level security/,
    );
    await rejects(rpc(C, 'get_conversation', { p_conversation_id: conversationId }), 'not_found');
  });

  test('a participant cannot spoof the other participant as sender', async () => {
    await assert.rejects(
      as(B, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, $2, gen_random_uuid(), 'spoof')`, [conversationId, A]),
      /row-level security/,
    );
  });

  test('DND removes B from discovery immediately', async () => {
    const D = await makeUser({ name: 'Dev', tags: { interest: ['Photography'] } });
    await rpc(D, 'join_server_with_token', { p_token: token });
    await goAvailable(D);
    assert.ok((await rpcRows(D, 'discover_people', { p_server_id: serverId })).some((r) => r.user_id === B));
    await rpc(B, 'set_dnd');
    assert.ok(!(await rpcRows(D, 'discover_people', { p_server_id: serverId })).some((r) => r.user_id === B));
    // …and their card is no longer viewable by a non-connected co-member (no ghost profiles).
    await rejects(rpc(D, 'get_profile', { p_user_id: B }), 'not_found');
    // An existing connection keeps working while in DND.
    assert.equal((await rpc(A, 'get_profile', { p_user_id: B })).relationship.state, 'connected');
  });

  test('per-Server visibility opt-out hides B only in that Server', async () => {
    const D = await makeUser({ name: 'Diya' });
    await rpc(D, 'join_server_with_token', { p_token: token });
    await goAvailable(D);
    await goAvailable(B);
    assert.ok((await rpcRows(D, 'discover_people', { p_server_id: serverId })).some((r) => r.user_id === B));
    await as(B, 'update public.server_members set discoverable = false where server_id = $1 and user_id = auth.uid()', [serverId]);
    assert.ok(!(await rpcRows(D, 'discover_people', { p_server_id: serverId })).some((r) => r.user_id === B));
    await as(B, 'update public.server_members set discoverable = true where server_id = $1 and user_id = auth.uid()', [serverId]);
  });

  test('blocking: B blocks A → chat closed, hidden from discovery, cannot re-request in another Server', async () => {
    await rpc(B, 'block_user', { p_user_id: A });
    await assert.rejects(
      as(A, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, auth.uid(), gen_random_uuid(), 'still there?')`, [conversationId]),
      /row-level security/,
    );
    assert.equal((await as(A, 'select * from public.messages where conversation_id = $1', [conversationId])).length, 0);
    assert.equal((await rpcRows(A, 'list_conversations')).length, 0);
    await goAvailable(B);
    assert.ok(!(await rpcRows(A, 'discover_people', { p_server_id: serverId })).some((r) => r.user_id === B));
    await rejects(rpc(A, 'get_profile', { p_user_id: B }), 'not_found');
    // A second shared Server does not bypass the block.
    const { serverId: s2 } = await makeServer(A, [B], { name: 'Other Server' });
    await rejects(rpc(A, 'send_connection_request', { p_recipient: B, p_server_id: s2 }), 'unavailable');
  });

  test('reports go through the backend and are not visible to the reported user', async () => {
    const reportId = await rpc(B, 'create_report', { p_reason: 'harassment', p_details: 'test', p_target_user: A, p_server_id: serverId });
    assert.ok(reportId);
    assert.equal((await as(A, 'select id from public.reports where id = $1', [reportId])).length, 0);
    assert.equal((await as(B, 'select id from public.reports where id = $1', [reportId])).length, 1);
    // A is this Server's admin AND the reported user: the report must not reach them.
    const queue = await rpcRows(A, 'list_reports', { p_server_id: serverId });
    assert.ok(!queue.some((r) => r.id === reportId));
    await rejects(rpc(A, 'review_report', { p_report_id: reportId, p_status: 'dismissed' }), 'forbidden');
  });

  test('anonymous clients can read nothing and call nothing', async () => {
    await assert.rejects(as(null, 'select * from public.profiles'), /permission denied/);
    await assert.rejects(as(null, 'select * from public.messages'), /permission denied/);
    await assert.rejects(as(null, 'select public.list_my_servers()'), /permission denied/);
    await assert.rejects(as(null, `select public.join_server_with_token('x')`), /permission denied/);
  });

  test('sanity: superuser view confirms the private data exists (tests are not vacuous)', async () => {
    const rows = await admin('select count(*)::int as n from public.messages where conversation_id = $1', [conversationId]);
    assert.equal(rows[0].n, 2);
  });
});
