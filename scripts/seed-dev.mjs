#!/usr/bin/env node
// DEV/STAGING ONLY. Creates clearly-labelled test identities and a demo Server through the REAL APIs
// (Auth admin + RPCs as each user), so the app has something to talk to during development.
// Every seeded account uses the @sniff-test.invalid domain and a "[Test]" display-name prefix.
//
//   node --env-file=.env scripts/seed-dev.mjs [--users 12]
//
// Refuses to run when EXPO_PUBLIC_APP_ENV=production.
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const count = Number(args[args.indexOf('--users') + 1] || 12);
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !service) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (in .env).');
  process.exit(1);
}
if (process.env.EXPO_PUBLIC_APP_ENV === 'production') {
  console.error('Refusing to seed a production environment.');
  process.exit(1);
}

// Rotate all seeded accounts on every run; never publish or reuse a fixed password.
const PASSWORD = randomBytes(24).toString('base64url');
const admin = createClient(url, service, { auth: { persistSession: false } });
const PROFILES = [
  ['Aarav', ['Machine Learning', 'Startups'], ['Badminton'], 'IIT Kanpur', 'Software Engineer'],
  ['Bhavna', ['Photography', 'Design'], ['Trekking'], 'NID Ahmedabad', 'Product Designer'],
  ['Chirag', ['Finance', 'Startups'], ['Cricket'], 'IIM Bangalore', 'Analyst'],
  ['Diya', ['Music', 'Cinema'], ['Dance'], 'Delhi University', 'Writer'],
  ['Eshan', ['Machine Learning', 'Politics'], ['Chess'], 'IIT Kanpur', 'Researcher'],
  ['Fatima', ['Design', 'Books'], ['Running'], 'Srishti', 'UX Researcher'],
];

async function asUser(email) {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function must(p) {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

const users = [];
const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
for (let i = 0; i < count; i++) {
  const [name, interests, hobbies, uni, job] = PROFILES[i % PROFILES.length];
  const email = `seed${i}@sniff-test.invalid`;
  const display = `[Test] ${name} ${i}`;
  let user = existing.users.find((u) => u.email === email);
  if (!user) {
    user = (await must(admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: display } }))).user;
  } else {
    await must(admin.auth.admin.updateUserById(user.id, { password: PASSWORD }));
  }
  const client = await asUser(email);
  const { data: me } = await client.from('profiles').select('onboarded_at').eq('id', user.id).single();
  if (!me?.onboarded_at) {
    await must(client.rpc('complete_onboarding', {
      p_username: `test_${name.toLowerCase()}_${i}`.slice(0, 20), p_display_name: display, p_date_of_birth: '1998-01-01',
      p_gender: null, p_discovery_audience: 'everyone',
    }));
  }
  await must(client.rpc('set_my_tags', { p_kind: 'interest', p_names: interests }));
  await must(client.rpc('set_my_tags', { p_kind: 'hobby', p_names: hobbies }));
  await must(client.from('profiles').update({ university: uni, occupation: job, bio: 'Seeded test account for development.' }).eq('id', user.id));
  users.push({ id: user.id, email, client });
  process.stdout.write('.');
}

const owner = users[0];
const serverId = await must(owner.client.rpc('create_server', {
  p_name: '[Test] Sniff.in Dev Hall', p_kind: 'long_term', p_category: 'hall', p_join_policy: 'invite_only', p_visibility: 'unlisted',
}));
const token = await must(owner.client.rpc('create_join_token', { p_server_id: serverId, p_kind: 'code', p_label: 'Dev seed' }));
for (const u of users.slice(1)) await must(u.client.rpc('join_server_with_token', { p_token: token.token }));
for (const u of users.slice(1, Math.ceil(users.length / 2))) await must(u.client.rpc('set_availability', { p_minutes: 480 }));

console.log(`\nSeeded ${users.length} test users (password: ${PASSWORD}).`);
console.log(`Server "[Test] Sniff.in Dev Hall" → join code: ${token.token}`);
console.log(`Half the users are Available for 8 hours. Sign in as e.g. ${users[1].email}`);
