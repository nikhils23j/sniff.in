import { unregisterThisDevice } from '@/features/notifications/push';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { env } from '@/lib/env';
import { AppError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { sessionFromOAuthUrl } from './oauth';

/**
 * Email/password auth with 6-digit email OTP codes for verification and recovery.
 * Codes work on any device and don't depend on deep-link configuration. The Supabase email
 * templates must include {{ .Token }} (see supabase/templates and docs/SETUP.md).
 */
function guard() {
  if (!env.isBackendConfigured) throw new AppError('backend_not_configured', 'Sniff.in is not connected to its backend yet.');
}

async function unwrap<T extends { error: unknown }>(p: Promise<T>): Promise<T> {
  guard();
  const res = await p;
  if (res.error) throw toAppError(res.error);
  return res;
}

export const authApi = {
  async availableMethods(): Promise<{ phone: boolean; google: boolean }> {
    guard();
    const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: env.supabaseAnonKey },
    });
    if (!response.ok) throw new AppError('auth_settings_unavailable', 'Could not check sign-in methods. Please try again.');
    const settings: { external?: Record<string, boolean> } = await response.json();
    return {
      phone: settings.external?.phone === true,
      google: settings.external?.google === true,
    };
  },

  async sendPhoneCode(phone: string, captchaToken?: string) {
    await unwrap(supabase.auth.signInWithOtp({ phone, options: { captchaToken, shouldCreateUser: true } }));
  },

  async verifyPhoneCode(phone: string, token: string) {
    await unwrap(supabase.auth.verifyOtp({ phone, token, type: 'sms' }));
  },

  async requestPhoneLink(phone: string) {
    await unwrap(supabase.auth.updateUser({ phone }));
  },

  async verifyPhoneLink(phone: string, token: string) {
    await unwrap(supabase.auth.verifyOtp({ phone, token, type: 'phone_change' }));
  },

  async signInWithGoogle() {
    guard();
    const methods = await this.availableMethods();
    if (!methods.google) {
      throw new AppError('provider_not_configured', 'Google sign-in is not configured yet.');
    }
    const redirectTo = Linking.createURL('auth/callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw toAppError(error);
    if (!data.url) throw new AppError('oauth_url_missing', 'Could not start sign-in. Please try again.');
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return false;
    await unwrap(supabase.auth.setSession(sessionFromOAuthUrl(result.url)));
    return true;
  },
  async updateEmail(email: string) {
    await unwrap(supabase.auth.updateUser({ email }));
  },
  async signUp(email: string, password: string, displayName: string, captchaToken?: string) {
    const { data } = await unwrap(
      supabase.auth.signUp({ email, password, options: { data: { display_name: displayName }, captchaToken } }),
    );
    // With "Confirm email" enabled, Supabase returns no session until the code is verified.
    // An empty identities array means the email is already registered (Supabase obfuscates this).
    if (data.user && data.user.identities?.length === 0) {
      throw new AppError('user_already_exists', 'An account with this email already exists. Try signing in.');
    }
    return { needsVerification: !data.session };
  },

  async verifySignupCode(email: string, token: string) {
    await unwrap(supabase.auth.verifyOtp({ email, token, type: 'signup' }));
  },

  async resendSignupCode(email: string, captchaToken?: string) {
    await unwrap(supabase.auth.resend({ type: 'signup', email, options: { captchaToken } }));
  },

  async signIn(email: string, password: string, captchaToken?: string) {
    await unwrap(supabase.auth.signInWithPassword({ email, password, options: { captchaToken } }));
  },

  async sendPasswordReset(email: string, captchaToken?: string) {
    await unwrap(supabase.auth.resetPasswordForEmail(email, { captchaToken }));
  },

  async verifyRecoveryCode(email: string, token: string) {
    await unwrap(supabase.auth.verifyOtp({ email, token, type: 'recovery' }));
  },

  async updatePassword(password: string) {
    await unwrap(supabase.auth.updateUser({ password }));
  },

  async signOut() {
    // Best effort while the session is still valid: stop push to this device. Availability is an account-wide
    // setting (synced across devices), so signing out of one device does not change it.
    await Promise.allSettled([unregisterThisDevice()]);
    // Local sign-out always succeeds even if the network is down.
    await supabase.auth.signOut({ scope: 'local' });
  },

  /** Server-side deletion via Edge Function (needs the service role, which never ships to clients). */
  async deleteAccount() {
    guard();
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) throw toAppError(error);
    await supabase.auth.signOut({ scope: 'local' });
  },
};
