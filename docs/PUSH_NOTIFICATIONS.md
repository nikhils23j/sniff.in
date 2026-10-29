# Push notifications

In-app notifications and chat badges use database rows and Realtime. Device push needs an EAS project, Android FCM V1 / iOS APNs credentials, and the durable worker below.

## Current pipeline

`notifications` insert/update → private `push_jobs` row → `pg_net` wakes `send-push` → leased job → Expo push tickets → later receipt check. `sniffin-push-worker` runs each minute as a recovery path after missed calls, worker crashes or provider errors. A message push waits 10 seconds and is skipped if the message was read; user preferences and device tokens are rechecked immediately before dispatch. A provider ticket means accepted for processing, **not** that a person received or read the alert.

The old notifications Database Webhook must be removed on staging before using this migration, or it can cause duplicate worker wakeups. Migration `20261023001500` drops the old database dispatch trigger. `send-push` validates `x-webhook-secret`, leases jobs and records device outcomes with retry/backoff; receipts are checked after 15 minutes. It does not read private chat bodies into lock-screen alerts.

## Configure staging

1. Initialize the Expo/EAS project and make sure `extra.eas.projectId` is the intended project. Add Android package `in.sniff.app` in Firebase; place `google-services.json` outside source control and set `GOOGLE_SERVICES_JSON` (or put the file in the repo root). Upload the FCM V1 service-account key through EAS credentials. Configure APNs for iOS when its developer account is ready.
2. Set Supabase Edge Function secret `PUSH_WEBHOOK_SECRET` to a random value. Store the **same** value in Supabase Vault as `sniffin_internal_secret`, and Vault `sniffin_functions_url` as `https://<ref>.supabase.co/functions/v1`. Deploy `send-push` and `media-cleanup` with `--no-verify-jwt`; they reject calls without that secret header. `EXPO_ACCESS_TOKEN` is optional if Expo push security is enabled.
3. Confirm `pg_cron`, `pg_net`, `cron.job` and the two scheduled jobs. Verify the 5-minute `sniffin-maintenance` job calls `app_private.run_maintenance_campus_media()` and the 1-minute `sniffin-push-worker` calls `send-push`.
4. On two physical devices test request/message pushes in foreground, background and killed states; read a chat before the 10-second delay; disable a category; simulate a revoked device token. Inspect `app_private.push_jobs` and `app_private.push_delivery_attempts` for aged pending/failed jobs and receipts.

Generic titles are used by default. Names can appear only if a user enables previews; message text is never sent in push payloads. Keep a separate test for Android lock-screen visibility and iOS notification permissions before release.
