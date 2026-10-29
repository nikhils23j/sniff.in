// Test harness: executes SQL exactly as PostgREST would for a signed-in user
// (role `authenticated` + request.jwt.claims), against the local test database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const pool = new pg.Pool({
  database: process.env.TEST_DB ?? 'sniffin_test',
  max: Number(process.env.DB_POOL_MAX ?? 10),
});

/** Superuser query (test setup only, bypasses RLS). */
export async function admin(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

/** Run `sql` as the given user id (or anon when uid is null) in its own committed transaction. */
export async function as(uid, sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' }),
    ]);
    const res = await client.query(sql, params);
    await client.query('commit');
    return res.rows;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Call an RPC and return its scalar/json result. */
export async function rpc(uid, fn, args = {}) {
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  const rows = await as(uid, sql, keys.map((k) => args[k]));
  return rows[0]?.r;
}

/** Call a set-returning RPC. */
export async function rpcRows(uid, fn, args = {}) {
  const keys = Object.keys(args);
  const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
  return as(uid, sql, keys.map((k) => args[k]));
}

/** Assert the promise rejects with a message starting with `code`. */
export async function rejects(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(
      String(e.message).startsWith(code) || String(e.message).includes(code),
      `expected error "${code}", got "${e.message}"`,
    );
    return true;
  });
}

let counter = 0;
/** Create an auth user (fires the bootstrap trigger) and complete onboarding. */
export async function makeUser(opts = {}) {
  const n = ++counter;
  const tag = randomUUID().slice(0, 6);
  const [{ id }] = await admin(
    `insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, $2, now()) returning id`,
    [`u${n}_${tag}@test.local`, { display_name: opts.name ?? `User ${n}` }],
  );
  if (opts.onboard !== false) {
    await rpc(id, 'complete_onboarding', {
      p_username: `u${n}_${tag}`.toLowerCase().slice(0, 20),
      p_display_name: opts.name ?? `User ${n}`,
      p_date_of_birth: opts.dob ?? '1999-05-01',
      p_gender: opts.gender ?? null,
      p_discovery_audience: opts.audience ?? 'everyone',
    });
  }
  if (opts.tags) {
    for (const [kind, names] of Object.entries(opts.tags)) {
      await rpc(id, 'set_my_tags', { p_kind: kind, p_names: names });
    }
  }
  return id;
}

/** Create a server owned by `owner`, issue a QR token, and have `members` join with it. */
export async function makeServer(owner, members = [], opts = {}) {
  const serverId = await rpc(owner, 'create_server', {
    p_name: opts.name ?? `Server ${randomUUID().slice(0, 4)}`,
    p_kind: opts.kind ?? 'long_term',
    p_category: opts.category ?? 'community',
    p_ends_at: opts.ends_at ?? null,
    p_ephemeral_chats: opts.ephemeral ?? false,
    p_join_policy: opts.join_policy ?? 'invite_only',
    p_visibility: opts.visibility ?? 'unlisted',
    p_parent_id: opts.parent_id ?? null,
  });
  const [token] = await as(owner, `select * from public.create_join_token($1, 'qr')`, [serverId]);
  for (const m of members) await rpc(m, 'join_server_with_token', { p_token: token.token });
  return { serverId, token: token.token };
}

/** V2: people recommendations require Open to Talk (which implies Available). */
export const goAvailable = (uid, topic = null) => rpc(uid, 'set_open_to_talk', { p_open: true, p_topic: topic });
