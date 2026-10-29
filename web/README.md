# Sniff.in link and verification site (static)

Serve this directory on the same HTTPS origin used for Android App Links. It provides invite links
(`/join?t=TOKEN`), profile links (`/@handle`), activity links (`/post/<id>`), the Spotify PKCE callback (`/spotify/callback`),
and the Turnstile page (`/captcha/`) loaded by the native app. `vercel.json` rewrites profile URLs
to a generic sign-in/install page; it does not expose profile data on the public web.

The origin also contains the verification files that let phones open supported links directly:

- `/.well-known/assetlinks.json`: Android App Links (package `in.sniff.app`, EAS signing-cert SHA-256).
  If you change the Android keystore, update the fingerprint (`apksigner verify --print-certs app.apk`).
- `/.well-known/apple-app-site-association`: iOS Universal Links. Replace `APPLE_TEAM_ID` with your paid Apple
  Developer Team ID (Associated Domains are not available to free Personal Teams).

## Deploy
```bash
npx vercel login
npx vercel deploy web --prod
```
Set `APP_LINK_DOMAIN=<hostname>`, `EXPO_PUBLIC_APP_URL=https://<hostname>` and
`EXPO_PUBLIC_CAPTCHA_URL=https://<hostname>/captcha/` for the Android build. Register the exact
`https://<hostname>/spotify/callback` redirect with Spotify if using the allowlisted test app.
Rebuild after changing the App Link domain or signing key and test installed/uninstalled behavior.

The install buttons in `web/join/`, `web/profile/` and `web/post/` all point to `/android`.
That route downloads the verified Android APK from `web/downloads/` when the release is deployed.
Replace the APK and verify its signing certificate and cold launch before deploying a new version;
an older build cannot be assumed to understand new profile and activity links.
For backend, CAPTCHA and Spotify setup order, see `docs/SETUP.md`.
