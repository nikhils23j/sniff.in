import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { admin, as, makeServer, makeUser, rejects, rpc, rpcRows } from './helpers.mjs';

describe('V3.1 onboarding profile and chat redesign', () => {
  test('an unfinished profile can reserve profile media and save its final prompt', async () => {
    const user = await makeUser({ onboard: false });
    const profilePath = `${user}/onboarding.jpg`;
    await rpc(user, 'reserve_media_upload', { p_bucket: 'profile-photos', p_path: profilePath, p_bytes: 128 });
    await rejects(rpc(user, 'reserve_media_upload', { p_bucket: 'feedback-media', p_path: `${user}/feedback.jpg`, p_bytes: 128 }), 'onboarding_required');
    await admin(`insert into storage.objects(bucket_id,name,owner,metadata) values('profile-photos',$1,$2,'{"size":128}'::jsonb)`, [profilePath, user]);
    const photoId = await rpc(user, 'add_profile_photo', { p_path: profilePath, p_position: null });
    assert.ok(photoId);
    await rpc(user, 'set_profile_prompt', { p_key: 'simple_pleasures', p_answer: 'Long walks after sunset' });
    const [saved] = await as(user, `select prompt_key,answer from public.profile_prompt_answers where user_id=auth.uid()`);
    assert.deepEqual(saved, { prompt_key: 'simple_pleasures', answer: 'Long walks after sunset' });
  });

  test('progressive onboarding fields are stored and field visibility is enforced', async () => {
    const owner = await makeUser();
    const a = await makeUser({ gender: 'woman' });
    const b = await makeUser({ gender: 'woman' });
    const { serverId } = await makeServer(owner, [a, b]);
    await rpc(a, 'complete_onboarding_profile', { p_payload: {
      username: `person_${a.slice(0, 6)}`, display_name: 'Person A', date_of_birth: '1999-05-01', gender: 'woman',
      discovery_audience: 'everyone', talk_to_genders: ['woman', 'nonbinary'], height_cm: 170,
      education_level: 'postgraduate', school_name: 'Test University', workplace: 'Test Lab', job_title: 'Researcher',
      hometown: 'Jaipur', relationship_status: 'prefer_not_to_say', drinking: 'never', smoking: 'never',
      visibility: { height: 'only_me', education: 'members', occupation: 'members', hometown: 'members', relationship: 'connections', lifestyle: 'connections' },
    } });
    const view = await rpc(b, 'get_profile_in_server', { p_user_id: a, p_server_id: serverId });
    assert.equal(view.height_cm, null);
    assert.equal(view.school_name, 'Test University');
    assert.equal(view.hometown, 'Jaipur');
    assert.equal(view.relationship_status, null);
    const [privateRow] = await as(a, 'select talk_to_genders from public.profile_private where user_id=auth.uid()');
    assert.equal(privateRow.talk_to_genders, '{woman,nonbinary}');
  });

  test('available-person discovery respects shared Servers and notes stay connection-only', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const outsider = await makeUser();
    const { serverId } = await makeServer(owner, [a, b]);
    await rpc(b, 'set_available', { p_available: true });
    const available = await rpc(a, 'available_people_for_chat', { p_limit: 30 });
    assert.ok(available.some((x) => x.user.id === b && x.server_id === serverId));
    assert.ok(!available.some((x) => x.user.id === outsider));
    const discover = await rpcRows(a, 'discover_available_people', { p_server_id: serverId, p_limit: 20, p_offset: 0 });
    assert.ok(discover.some((x) => x.user_id === b), 'Available is sufficient for permanent-Server discovery');

    await rpc(b, 'set_chat_note', { p_body: 'Coffee after class?', p_song_title: null, p_song_artist: null, p_song_url: null });
    assert.ok(!(await rpc(a, 'list_chat_notes')).some((x) => x.user.id === b));
    const sent = await rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId, p_message: null });
    await rpc(b, 'respond_to_request', { p_request_id: sent.request_id, p_accept: true });
    const notes = await rpc(a, 'list_chat_notes');
    assert.equal(notes.find((x) => x.user.id === b)?.body, 'Coffee after class?');
    const profile = await rpc(a, 'get_profile_in_server', { p_user_id: b, p_server_id: serverId });
    assert.equal(Number(profile.connection_count), 1, 'one accepted pair is counted once for both people');
  });
});
