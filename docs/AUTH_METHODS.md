# Sign-in methods in version 3.3

Three illustrated introduction cards appear before the sign-in choices. The welcome button opens one screen with phone, email, and Google. Email uses the existing confirmed-address signup and password/recovery flows. Phone asks Supabase to send a six-digit SMS code, then verifies that code. Google opens Supabase OAuth in a system browser and returns to `sniffin://auth/callback`, where the app stores the returned session. The login code never contains an SMS or OAuth provider secret.

Phone-only accounts may continue onboarding without adding an email. Existing email users should first link a phone in **Settings → Data & account → Sign-in methods** to keep the same account when switching methods. A phone number used to create a separate account cannot be silently merged into an existing account.

## Hosted project status (checked 25 October 2026)

`GET /auth/v1/settings` reports email enabled, and phone and Google disabled. The app checks this setting and gives a clear setup message if a disabled method is tapped. Those two methods cannot pass a real end-to-end test until their respective provider is enabled. Email can still be used.

## Enable phone

1. For limited development testing, use [Twilio Verify's trial](https://www.twilio.com/docs/usage/trials/try-out-verify), not the ordinary Twilio Messaging trial: the latter limits custom SMS bodies, while Verify is intended for OTPs. Create a Twilio account, open Identity → Verify, create a Verify Service, and verify each tester's phone number in Twilio. The current trial expires after 30 days, allows up to five verified recipients, and includes 40 successful verifications; it is not a free public-SMS tier. For Indian recipients, check [Twilio's current India requirements](https://www.twilio.com/docs/sms/regulatory-requirements) before launch.
2. In Supabase Dashboard → Authentication → Providers → Phone, choose **Twilio Verify**, enter its Account SID, Auth Token, and Verify Service SID, enable Phone, and save. Keep the Auth Token in Supabase, never in `EXPO_PUBLIC_*` or the repository. Keep public phone login disabled until a funded SMS provider is available.
3. Keep Supabase's SMS rate limits and CAPTCHA appropriate for a public launch. Request an SMS on an Android device and an iPhone, enter the actual code, verify a new profile is created, sign out, then sign back in with the same number. Test an expired and incorrect code and the 60-second resend guard. From an existing email account, link and verify a phone in Settings and confirm phone sign-in returns to the **same account ID**.

Reference: [Supabase phone sign-in](https://supabase.com/docs/guides/auth/phone-login).

## Enable Google

1. In Google Cloud Console, create a **Web application** OAuth client. Add your deployed HTTPS website under authorized JavaScript origins and `https://<YOUR-SUPABASE-PROJECT-REF>.supabase.co/auth/v1/callback` under authorized redirect URIs. If the consent screen is in testing mode, add each tester as a test user.
2. Copy that client's **Client Secret** from Google Cloud Console. In Supabase Dashboard → Authentication → Providers → Google, enter this Client ID and its matching Client Secret, enable the provider, and save. Keep the secret only in Supabase. The app uses Supabase's browser OAuth flow and does not need a Google client secret in its bundle.
3. In Supabase Dashboard → Authentication → URL Configuration, allow `sniffin://**` as a redirect URL. Verify it is present in the hosted project; it is already listed in the repository's `supabase/config.toml` for local development.
4. On Android and iOS, choose Google, complete account consent, confirm the browser returns to Sniff.in, then sign out and repeat to confirm the same account opens. Test cancellation and a denied consent. For an existing email account, verify identity linking on a disposable test account before using it on real users.

The mobile app reads provider availability from hosted Supabase when its sign-in screen opens, so enabling a provider does not require a new app binary. It still requires the real-device tests above before declaring that method ready for users.

Reference: [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) and [mobile deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking).
