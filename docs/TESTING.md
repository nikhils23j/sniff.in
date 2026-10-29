# Testing the campus pilot branch

## Automated evidence (local, 23 October 2026)

| Check | Result / scope |
|---|---|
| `npx tsc --noEmit`, `npx expo lint` | TypeScript clean; lint has zero errors (warnings recorded in implementation tracker) |
| `npm test -- --runInBand` | 35 unit tests, including 100-event realtime invalidation burst and batch private URL signing |
| `npm run test:db` | 41 fresh migrations, 82 tests with auth/RLS shim and real `authenticated`/`anon` role attempts; includes concurrency, temporary sessions, profile modes, badges, media reservation/thumbnail cleanup, feedback, push lease/receipt, request/conversation/connection cursor tests |
| `npm run functions:check` | All Deno Edge Functions type-check |
| `npx expo-doctor` | SDK dependency/config checks |
| `npx expo export --platform web` and `--platform android` | JavaScript bundle and route compilation, not device runtime |

The shim in `supabase/tests/shim/` is for local PostgreSQL only. It does not test hosted Supabase Auth, Realtime delivery, Storage transfer or push providers.

The full local load fixture was run against 1,000 identities, 40 permanent communities, one busy temporary venue, 4,000 activity posts, 5,000 messages and 20 concurrent DB workers (`N=1000 CONCURRENCY=20 DB_POOL_MAX=20 ACTIVITY_PER_COMMUNITY=100`). Results: `discover_people` p95 353 ms, dashboard p95 191 ms, activity page p95 10 ms, message insert p95 9 ms. Maintained engagement summary aggregation was 0.31 ms / 49 shared buffer hits versus correlated scans at 16.71 ms / 4,991 hits. These timings exclude network/device and do **not** establish hosted capacity. Planner statistics were refreshed after fixture insertion.

## Hosted staging automation

Copy `.env.staging.example` to `.env.staging` and use a disposable **staging** project. `E2E_TARGET=staging` and `STAGING_PROJECT_REF` must match the Supabase URL hostname. The scripts create and delete test accounts; never point them at production.

```bash
npm run test:e2e:live       # real Auth, RPC, Realtime, Storage and Edge Function flow
npm run test:auth:staging    # controlled 20-account same-IP login burst, p50/p95 and errors
```

These hosted checks have **not run for this branch** because staging credentials and deployed migrations/functions are not present locally. Sign-up/resend/recovery still need a separately observed run using real mailbox delivery and Turnstile; admin-created accounts in the scripts bypass email confirmation and CAPTCHA. Do not infer email or CAPTCHA readiness from the login burst.

## Two-device staging matrix

Use two physical Android devices first and an iPhone for cross-platform screens. Record build ID, Supabase project, OS version, network and pass/fail for each step.

| # | Scenario | Expected result |
|---|---|---|
| 1 | Sign up on shared campus Wi-Fi, verify email, resend, wrong code, recover password | Correct retry/cooldown messages; SMTP and Turnstile succeed without lockout |
| 2 | Create permanent and temporary servers; scan QR after sign-out/sign-in | Correct preview and joined server; expired/invalid token shows a safe error |
| 3 | Set personal/professional/both profile mode and a member note in one permanent server | Other servers keep independent choices; profile preview and another account see only permitted fields |
| 4 | At temporary venue choose Open to Talk for 31 min/2 h/custom, topic, profile mode and location hint | Only opted-in members appear in venue cards; expiry/early leave removes them without reopening the app |
| 5 | Three participants at one venue, then expire one | Hot Map uses aggregate venue coordinates, falls below visibility threshold, no person coordinate is exposed |
| 6 | Home person/activity/venue cards; swipe left/right and open profile | Correct next card and permitted details; no control sits under tab bar or notch |
| 7 | Admin appoints moderator; moderator assigns/revokes badge, tries to remove member | Badge visible only in shared permanent server scope; moderator removal rejected by backend |
| 8 | Add six extra profile photos and three optional answers, preview as another member | Photos open full-size; permissions match viewer context; no signup prompt burden |
| 9 | Edit profile, swipe back, kill/reopen app, Save/Discard/Keep editing | Draft remains account-scoped; saved values agree on Me, preview and another device |
| 10 | Post multiple activity photos, reorder/remove, view gallery, respond | Gallery order persists; unauthorized users cannot sign media; no PDF option |
| 11 | Upload on Small/Balanced/Best quality from profile, chat, activity, server and feedback | Sensible dimensions/bytes and visible progress; no EXIF location; orphan cleanup after interruption |
| 12 | Send text/photo/large document under unstable network; retry | One logical message after retry; large transfer resumes or abandoned object is swept |
| 13 | Reach beyond 100 requests, 200 conversations and 500 connections, including equal timestamps | Every older item reachable once; badges update after read/accept |
| 14 | Two accounts on one phone, sign out/in and restart mid-draft/mid-send | No prior account cache, draft, outbox or private media shown |
| 15 | Feedback with text, category and optional screenshot | Confirmation shown; owner can review privately; unrelated account cannot read screenshot |
| 16 | Android app installed/uninstalled, signed in/out: open `/@handle`, invite and activity links | Exact destination or safe sign-in/install fallback; unavailable profile/content handled |
| 17 | With Spotify test app configured, Connect/Reconnect/Disconnect | PKCE returns to Android, profile link updates; cancel/expired state safe; no password stored |
| 18 | Android/iOS foreground/background/killed push, read-before-delay, disabled preference | No stale message alert; provider ticket/receipt captured; no private message body |
| 19 | Small phone, large text, dark mode, screen reader and reduced motion | Readable contrast, labels, touch targets, scrolling and safe areas |

Before a production rollout, rerun the hosted and device checks on the exact release candidate, inspect DB CPU, lock waits, `push_jobs`/media cleanup age, Storage egress and Supabase Auth errors, then record a reversible migration/build plan. R06's broader alerting and backup rehearsal remain on hold pending the user's separate decision.
