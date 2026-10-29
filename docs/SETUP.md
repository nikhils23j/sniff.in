# Setup: campus pilot branch

Use a separate staging Supabase project for development and destructive live tests. Keep production credentials out of `.env.staging`.

## Local tools and app

Use Node 22, current Supabase CLI, PostgreSQL 17 with pgvector for local DB tests, and Deno for Edge Function checks. This repo uses npm (`package-lock.json`, no Bun lockfile).

```bash
npm install
cp .env.example .env
# Fill in the Supabase URL and publishable/anon key, and the actual HTTPS app URL.
npx expo-doctor
npx expo start --dev-client
```

Camera, secure storage and other native modules need an Expo development build; Expo Go is insufficient. Use `npx eas-cli@latest build --profile development --platform android` (or iOS with the appropriate Apple account). Native `ios/` and `android/` folders are generated, not maintained in this repository.

## Phone OTP for onboarding

Phone-only accounts can onboard after Supabase verifies an SMS code; existing email accounts can link a phone in Settings. In Supabase Dashboard, open **Authentication → Sign In / Providers → Phone**, enable Phone, and configure a
supported SMS provider. Add the provider credentials as Supabase secrets; never add them to Expo environment
variables. Set sensible OTP expiry and per-number/IP rate limits, then verify delivery on real Indian and
international numbers before release. Supabase does not send production SMS by itself: the selected provider bills
for messages, so this step is not generally free beyond any provider trial credit.

## Staging backend

1. Create a staging Supabase project in the intended region. Set up custom SMTP, confirmed email, the six-digit `{{ .Token }}` email templates in `supabase/templates/`, password policy and suitable Auth rate limits. Use a separate production project later.
2. `supabase link --project-ref <staging-ref>` and `supabase db push`. The migrations create private Storage buckets, authorization functions, engagement summaries, push jobs and media cleanup. Enable `pg_cron`, `pg_net` and Vault as required by the migrations; check `cron.job` for `sniffin-maintenance` and `sniffin-push-worker`. If `pg_cron` was disabled at migration time, schedule the current functions shown in migrations `20261023001500` and `20261023001600`; do not schedule the older `run_maintenance()` entry point.
3. Deploy public-user functions (`icebreakers`, `delete-account`, `embed-profile`, `affiliation-verify`, `gif-search`, `spotify-connect`) with normal JWT verification. Deploy internal workers `send-push` and `media-cleanup` with `--no-verify-jwt`; they authenticate the database's `x-webhook-secret` instead. Configure `PUSH_WEBHOOK_SECRET` in Supabase secrets and the same value in Vault as `sniffin_internal_secret`, with Vault `sniffin_functions_url=https://<ref>.supabase.co/functions/v1`. See `docs/PUSH_NOTIFICATIONS.md`.
4. The service-role key belongs only in staging scripts and Edge Functions. Never put it in an `EXPO_PUBLIC_` variable or a mobile build. Add a platform admin after signup through the SQL editor.

## CAPTCHA and website

The app includes a Turnstile challenge on signup, login, resend and recovery. First deploy `web/` to an HTTPS host. Set `EXPO_PUBLIC_APP_URL` to that origin, `APP_LINK_DOMAIN` to its hostname, `EXPO_PUBLIC_CAPTCHA_URL` to `<origin>/captcha/`, and `EXPO_PUBLIC_TURNSTILE_SITE_KEY` to the public key for that hostname. Configure the matching Turnstile secret in Supabase Auth **only after** testing the widget in Android and web; enabling server CAPTCHA first would block authentication. Rebuild the native app when the App Link domain changes. Verify `/.well-known/assetlinks.json` contains the signing certificate for that build.

The site also hosts `/@handle` profile fallback, `/post/<id>` activity fallback and `/spotify/callback`. Its install buttons link to the tested Version 3 APK. The Android fallback still needs installed/uninstalled and signed-in/out link-flow testing; it is not a substitute for an app-store listing.

## Spotify developer access

1. Sign into the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app. Add its name/description, website, Android package `in.sniff.app`, and the **exact** HTTPS redirect URI `<EXPO_PUBLIC_APP_URL>/spotify/callback` in app settings.
2. Copy the **Client ID** to `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` in the Android EAS build environment; this is public. Do not put the Client Secret in the app. The implemented Android flow uses authorization code with PKCE and the Edge Function checks the temporary token against Spotify before saving the account link. Tokens are not retained.
3. Add up to five Spotify test users under Users Management, then test Connect/Reconnect/Disconnect on a physical Android build. The owner must have Spotify Premium for a development-mode app. Spotify's development quota cannot serve the 1,000–2,000-person pilot; keep the button unconfigured in wider builds until Spotify grants extended access. See [apps](https://developer.spotify.com/documentation/web-api/concepts/apps), [quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), [redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

Spotify does not list a separate developer-app registration fee in those instructions. A Premium subscription is required for the development-mode owner, and extended access requires Spotify's organizational review; it is not an automatic paid upgrade.

## Verification before release

```bash
npx tsc --noEmit
npx expo lint
npx expo-doctor
npm test -- --runInBand
npm run test:db
scripts/db-local-reset.sh sniffin_campus_review_20261023
TEST_DB=sniffin_campus_review_20261023 N=1000 CONCURRENCY=20 DB_POOL_MAX=20 npm run test:db:load
npm run functions:check
```

For hosted staging tests, copy `.env.staging.example` to `.env.staging`, fill in the **staging-only** keys, and run `npm run test:e2e:live` and `npm run test:auth:staging`. Those scripts create and delete throwaway users and require `E2E_TARGET=staging` plus a matching project-ref hostname. Do not run them on production. The manual two-phone matrix is in `docs/TESTING.md`.
