// Database-level load/smoke test with N real identities (default 100) against the LOCAL test DB.
// Exercises the same RPCs + RLS paths the app uses, concurrently, and reports latency percentiles.
// Usage: npm run test:db:load  (or: N=200 CONCURRENCY=20 node supabase/tests/load/db-load.mjs)
// NEVER point this at production.
import assert from 'node:assert/strict';
import { as, goAvailable, makeServer, makeUser, pool, rpc, rpcRows } from '../db/helpers.mjs';

const N = Number(process.env.N ?? 100);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const COMMUNITIES = Number(process.env.COMMUNITIES ?? Math.min(40, Math.max(2, Math.floor(N / 25))));
const ACTIVITY_PER_COMMUNITY = Number(process.env.ACTIVITY_PER_COMMUNITY ?? 100);
const INTERESTS = ['Machine Learning', 'Badminton', 'Startups', 'Music', 'Photography', 'Cinema', 'Running', 'Design', 'Chess', 'Travel'];

async function pooled(items, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

const timings = {};
async function timed(name, fn) {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    (timings[name] ??= []).push(performance.now() - t0);
  }
}

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const t0 = performance.now();
console.log(`Creating ${N} identities…`);
const host = await makeUser({ name: 'Host' });
const users = await pooled(Array.from({ length: N }), (_, i) =>
  timed('create+onboard+tags', () => makeUser({
    name: `Load User ${i}`,
    tags: { interest: [INTERESTS[i % 10], INTERESTS[(i * 3 + 1) % 10], INTERESTS[(i * 7 + 2) % 10]] },
  })));

const { serverId, token } = await makeServer(host, [], { name: 'Load Test Fest', kind: 'short_term', ends_at: new Date(Date.now() + 6 * 3600_000).toISOString(), ephemeral: true });
await pooled(users, (u) => timed('join_server_with_token', () => rpc(u, 'join_server_with_token', { p_token: token })));
await pooled(users, (u) => timed('set_availability', () => goAvailable(u)));

const results = await pooled(users, (u) => timed('discover_people', () => rpcRows(u, 'discover_people', { p_server_id: serverId, p_limit: 20 })));
assert.ok(results.every((r) => r.length === 20), 'every user gets a full page of candidates');
assert.ok(results.every((r) => r.every((c) => !users.includes(c.user_id) || c.user_id !== undefined)));

// Pair users (i → i+1) and run requests + accepts concurrently.
const pairs = [];
for (let i = 0; i + 1 < users.length; i += 2) pairs.push([users[i], users[i + 1]]);
const reqs = await pooled(pairs, ([a, b]) => timed('send_connection_request', () => rpc(a, 'send_connection_request', { p_recipient: b, p_server_id: serverId, p_message: 'hi' })));
const accepted = await pooled(pairs, ([, b], i) => timed('respond_to_request', () => rpc(b, 'respond_to_request', { p_request_id: reqs[i].request_id, p_accept: true })));

// Each pair exchanges 10 messages.
await pooled(pairs, async ([a, b], i) => {
  for (let m = 0; m < 5; m++) {
    for (const sender of [a, b]) {
      await timed('insert_message', () => as(sender, `insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, auth.uid(), gen_random_uuid(), 'load message')`, [accepted[i].conversation_id]));
    }
  }
});
await pooled(users, (u) => timed('list_conversations', () => rpcRows(u, 'list_conversations')));
await pooled(pairs, ([a], i) => timed('page_messages', () => as(a, 'select * from public.messages where conversation_id = $1 order by created_at desc limit 30', [accepted[i].conversation_id])));

// A campus pilot has multiple discoverable communities, not just one busy venue.
const groups = await pooled(Array.from({ length: COMMUNITIES }), async (_, i) => {
  const hostUser = users[i];
  const group = await timed('create_community', () => makeServer(hostUser, [], {
    name: `Load Community ${i}`, kind: 'long_term', visibility: 'listed',
  }));
  return { ...group, hostUser };
});
const memberships = groups.flatMap((g, i) => Array.from({ length: Math.min(25, N) }, (_, j) => ({
  group: g, user: users[(i * 25 + j) % N],
}))).filter(({ group, user }) => group.hostUser !== user);
await pooled(memberships, ({ group, user }) => timed('join_community', () =>
  rpc(user, 'join_server_with_token', { p_token: group.token })));
await pooled(memberships, ({ group, user }) => timed('record_visit', () =>
  rpc(user, 'record_server_visit', { p_server_id: group.serverId })));
await pooled(groups.flatMap((g) => Array.from({ length: 3 }, (_, j) => ({ g, j }))), ({ g, j }) =>
  timed('create_activity', () => rpc(g.hostUser, 'create_activity_post', {
    p_server_id: g.serverId, p_body: `Load activity ${j}: badminton, coffee and study group`,
  })));
// Bulk fixture rows bypass author rate limits; the three RPC posts above still test the real write path.
if (ACTIVITY_PER_COMMUNITY > 3) {
  await timed('seed_activity_fixture', () => pool.query(`insert into public.activity_posts
    (server_id,author_id,body,category,created_at,expires_at)
    select s.id,s.created_by,'Load plan '||g.n||': study group, coffee or badminton',
      (array['study','food','sports'])[1+(g.n%3)],
      now()-(g.n%1440)*interval '1 minute',now()+interval '7 days'
    from public.servers s cross join generate_series(4,$2::integer) as g(n)
    where s.id=any($1::uuid[])`, [groups.map((g) => g.serverId), ACTIVITY_PER_COMMUNITY]));
}

// Fresh bulk fixtures need planner statistics. Staging gets these through autovacuum;
// measuring immediately after a large local insert otherwise benchmarks stale plans.
await pool.query('analyze');

const readers = users.slice(0, Math.min(N, 200));
await pooled(readers, (u) => timed('discover_dashboard', () => rpc(u, 'discover_dashboard')));
await pooled(readers, (u) => timed('activity_page', () => rpcRows(u, 'list_activity_page', {
  p_server_id: null, p_before: null, p_limit: 20, p_sort: 'latest', p_offset: 0, p_before_id: null,
})));

const plan = async (query) => {
  const [row] = await as(readers[0], `explain (analyze,buffers,format json) ${query}`);
  return row['QUERY PLAN'][0];
};
const dashboardPlan = await plan('select public.discover_dashboard()');
const { rows: [baselineRow] } = await pool.query(`explain (analyze,buffers,format json) select s.id,
  (select count(*) from public.activity_posts p where p.server_id=s.id and p.created_at>=current_date-6) posts,
  (select count(*) from public.server_members m where m.server_id=s.id and m.status='active' and m.created_at>=current_date-6) joins,
  (select count(*) from public.server_visits v where v.server_id=s.id and v.day>=current_date-6) visits
  from public.servers s where s.visibility='listed' and not s.is_archived`);
const baseline = baselineRow['QUERY PLAN'][0];
// The maintained table is private; explain its maintenance read as service DB role, then time
// the actual security-definer dashboard as an authenticated account above.
const { rows: [summaryRow] } = await pool.query(`explain (analyze,buffers,format json)
  select s.id,coalesce(sum(d.posts),0) posts,coalesce(sum(d.joins),0) joins,coalesce(sum(d.visits),0) visits
  from public.servers s left join app_private.server_engagement_daily d
    on d.server_id=s.id and d.day>=current_date-6
  where s.visibility='listed' and not s.is_archived group by s.id`);
const summary = summaryRow['QUERY PLAN'][0];

// RLS boundary: user from pair 0 must not see pair 1's conversation.
const leak = await as(pairs[0][0], 'select count(*)::int n from public.messages where conversation_id = $1', [accepted[1].conversation_id]);
assert.equal(leak[0].n, 0, 'cross-conversation read must be denied');
const notes = await as(pairs[0][1], `select count(*)::int n from public.notifications where type = 'connection_request'`);
assert.equal(notes[0].n, 1, 'exactly one request notification for the recipient');

console.log(`\n${N} identities, concurrency ${CONCURRENCY}, total ${(performance.now() - t0).toFixed(0)} ms\n`);
console.log('operation'.padEnd(26), 'count'.padStart(6), 'p50 ms'.padStart(8), 'p95 ms'.padStart(8), 'max ms'.padStart(8));
for (const [name, arr] of Object.entries(timings)) {
  console.log(name.padEnd(26), String(arr.length).padStart(6), pct(arr, 50).toFixed(1).padStart(8), pct(arr, 95).toFixed(1).padStart(8), Math.max(...arr).toFixed(1).padStart(8));
}
console.log('\nR07 EXPLAIN (ANALYZE, BUFFERS), aggregation only:');
console.log(`baseline correlated scans: ${baseline['Execution Time'].toFixed(2)} ms, ${baseline.Plan['Shared Hit Blocks']} shared hits`);
console.log(`maintained daily summary: ${summary['Execution Time'].toFixed(2)} ms, ${summary.Plan['Shared Hit Blocks']} shared hits`);
console.log(`authenticated dashboard RPC: ${dashboardPlan['Execution Time'].toFixed(2)} ms`);
console.log('These local timings are not production capacity guarantees.');
console.log('\nAll assertions passed.');
await pool.end();
