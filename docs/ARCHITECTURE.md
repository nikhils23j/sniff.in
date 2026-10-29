# Architecture

The campus-pilot implementation includes server-scoped profile modes, expiring venue sessions, engagement summaries, durable push jobs, media reservations, feedback and paged conversations/requests. See [TESTING.md](TESTING.md) for validation and measured load. Some scale notes below describe the earlier V2 baseline.

```
┌──────────── Mobile app (Expo SDK 58, RN 0.88, TS strict) ────────────┐
│ Expo Router screens → feature hooks (TanStack Query) → feature api.ts │
│ Zustand (UI state) · RHF+Zod (forms) · SecureStore (session, chunked)│
└───────────────┬───────────────────────┬──────────────────────────────┘
                │ supabase-js (anon key + user JWT)
      ┌─────────▼─────────┐   ┌─────────▼──────────┐   ┌──────────────────────┐
      │ PostgREST / RPC   │   │ Realtime            │   │ Edge Functions (Deno)│
      │ RLS + SECURITY    │   │ postgres_changes,   │   │ icebreakers, embed-  │
      │ DEFINER functions │   │ RLS-filtered per    │   │ profile, send-push,  │
      │                   │   │ subscriber          │   │ delete-account       │
      └─────────┬─────────┘   └─────────┬──────────┘   └──────┬───────────────┘
                └──────────── Postgres 17 (+pgvector, citext, pg_trgm, pg_cron) ┘
                                           │ Storage: private `avatars` bucket
                                           │ Expo Push → FCM (Android) / APNs (iOS)
```

## Authorization model
- **Deny by default.** RLS is enabled on every `public` table. `anon` has no privileges. `authenticated` gets
  SELECT on a few tables (row-filtered), column-scoped UPDATE on its own rows, INSERT on `messages`, and EXECUTE on RPCs.
- **State changes go through RPCs** (`SECURITY DEFINER`, `search_path` pinned). Each derives the actor from
  `auth.uid()`, checks roles/relationships, validates the transition, rate-limits, writes an audit row when it's an
  admin action, and creates notifications.
- **Predicates live in `app_private`** (not exposed by PostgREST): `can_view_profile`, `has_server_role` (with
  downward admin inheritance), `is_blocked_between`, `audience_compatible`, `can_send_message`, …
- **Profiles are never selectable by other users.** `get_profile` / `get_profile_cards` / RPC "mini cards" apply
  `can_view_profile` and per-field visibility (`members` / `connections` / `only_me`).

`can_view_profile(viewer, target)` is true when: same user · platform admin · (target active AND not blocked AND
(connected · pending request either way · viewer is staff of a Server the target belongs to · safety-filter-compatible
AND (target is *live-available* and discoverable in a shared live Server · target has an active post in a shared live
Server))). Shared membership alone is **not** enough. That is what makes DND real.

## Data model (relationship summary)
```
auth.users 1─1 profiles 1─1 profile_private (DOB, gender, audience: owner-only)
                     1─1 user_settings (field visibility, AI consent, notification prefs)
                     1─1 presence (available_until: server-side expiry)
                     1─* profile_tags *─1 tags(kind, name)
                     1─1 cravings (→ servers?, expires_at)
servers (self-ref parent_id, depth ≤4, kind long/short/global, ends_at, ephemeral_chats, is_official)
  1─* server_members (role member/moderator/admin, status pending/active/banned, discoverable)
  1─* server_join_tokens (qr/link/code, expires_at, max_uses, use_count, revoked_at)
  1─* server_badges (kind, label, issued_by, issued_at, expires_at, status, revoked_*)  ← provenance
  1─* activity_posts 1─* activity_responses (→ connection_requests)
  1─* server_announcements
connection_requests (sender, recipient, server ctx, status FSM; ≤1 pending per unordered pair)
connections (user_a < user_b unique; status active/blocked; a_saved/b_saved; expires_at for ephemeral)
  1─1 conversations 1─* conversation_participants (last_read_at, hidden_at)
                    1─* messages (unique(sender_id, client_id) = idempotent sends)
  1─1 icebreakers (cached suggestions, source ai/template)
blocks · reports (content_snapshot) · moderation_actions (audit) · rate_limit_events
discovery_dismissals · interaction_feedback (private ±1) · endorsements (pending/approved/hidden)
notifications (dedupe_key, read_at, pushed_at) · push_tokens
feature_flags · entitlements (user|server, feature, source, status, period) · profile_embeddings (vector(1024))
platform_admins
```

## Key flows
- **Join:** QR encodes `https://sniff.in/join?t=<token>` → `preview_join_token` → `join_server_with_token`
  (row lock on the token, re-validate, cap uses, policy → active/pending). Invalid tokens return `{status:'invalid'}`
  without raising, so failed guesses are counted by the rate limiter.
- **Discovery:** `discover_people(server)` requires viewer active member + available + discoverable here.
  Stage 1 eligibility (set-based anti-joins), stage 2 ranking, explanation strings. See `MATCHING.md`.
- **Requests:** `send_connection_request` (context Server shared, cooldown after decline, crossed request ⇒ accept),
  `respond_to_request` (row lock, FSM trigger), `accept_request` creates connection + conversation + participants.
- **Chat:** direct INSERT on `messages` guarded by RLS `can_send_message` (active, unexpired, unblocked); trigger stamps
  server time, rate-limits, bumps `last_message_at`, notifies the other side (no body in the notification).
  Realtime subscription per open conversation (`conversation_id=eq.X`), refetch on reconnect/foreground.
- **Maintenance** (`app_private.run_maintenance`, pg_cron every 5 min): warn 30 min before ephemeral expiry, delete
  expired connections (cascade chat), archive ended short-term Servers and delete their posts/cravings, revoke their
  tokens, expire stale requests, clear lapsed presence, prune rate-limit/dismissal/old notification rows.

## Scale notes (measured, local Postgres 17, Apple Silicon, no network)
`supabase/tests/load/db-load.mjs`: 100 identities in one Server: discovery p95 28 ms; 500 available in one Server:
discovery p50 75 ms / p95 108 ms; message insert p95 ≈ 3 ms. Real-world latency adds network RTT and Supabase plan
limits. For very large single Servers (thousands simultaneously available) the next step is precomputed per-user tag
arrays / a materialised candidate table; the function already caps the candidate set at 1,000.
