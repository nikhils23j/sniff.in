#!/usr/bin/env node
// Controlled same-IP sign-in burst through the real Supabase Auth endpoint.
// Uses throwaway accounts and deletes them in finally. Staging only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const url = process.env.STAGING_SUPABASE_URL;
const anon = process.env.STAGING_SUPABASE_ANON_KEY;
const service = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const projectRef = process.env.STAGING_PROJECT_REF;
const n = Number(process.env.AUTH_BURST_N ?? 20);
if (!url || !anon || !service || !projectRef || process.env.E2E_TARGET !== 'staging') {
  throw new Error('Set E2E_TARGET=staging and STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY, STAGING_PROJECT_REF');
}
if (new URL(url).hostname !== `${projectRef}.supabase.co`) throw new Error('Staging URL and project ref do not match');
if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('AUTH_BURST_N must be 1–50');

const admin = createClient(url, service, { auth: { persistSession: false } });
const suffix = randomUUID().slice(0, 8);
const password = `Test-${randomUUID()}9a`;
const created = [];
const accounts = [];
const samples = [];
try {
  for (let i = 0; i < n; i++) {
    const email = `auth-burst-${suffix}-${i}@sniff-test.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error ?? new Error('Could not create test user');
    created.push(data.user.id);
    accounts.push(email);
  }
  await Promise.all(accounts.map(async (email) => {
    const client = createClient(url, anon, { auth: { persistSession: false } });
    const start = performance.now();
    const { error } = await client.auth.signInWithPassword({ email, password });
    samples.push({ ms: performance.now() - start, error: error?.message ?? null });
  }));
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const p = (x) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))].toFixed(0);
  console.log(JSON.stringify({ target: projectRef, attempted: n, succeeded: samples.filter((s) => !s.error).length,
    p50_ms: p(.5), p95_ms: p(.95), errors: samples.filter((s) => s.error).map((s) => s.error) }, null, 2));
  assert.equal(samples.filter((s) => s.error).length, 0, 'some same-IP sign-ins failed');
} finally {
  await Promise.all(created.map((id) => admin.auth.admin.deleteUser(id)));
}
