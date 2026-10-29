import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { AppHeader, Banner, Button, Card, ListGroup, ListRow, Screen, SectionHeader, Text, TextField, confirm, toast } from '@/components/ui';
import { authApi } from '@/features/auth/api';
import { e164Phone } from '@/features/auth/phone';
import { useSession } from '@/features/auth/session-store';
import { env } from '@/lib/env';
import { toAppError } from '@/lib/errors';
import { useTheme } from '@/theme';

const DELETED = [
  'Your profile, username, photos and settings',
  'Your Server memberships, badges and discovery history',
  'Your connections, requests and friendships',
  'Your chats and the messages you sent',
  'Your Activity posts and responses',
  'Your craving, notifications and push tokens',
];

export default function AccountScreen() {
  const { colors } = useTheme();
  const session = useSession();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState('+91');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [phonePending, setPhonePending] = useState<string | null>(null);
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const ready = confirmText.trim() === 'DELETE';

  const requestData = () =>
    Linking.openURL(
      `mailto:${env.supportEmail}?subject=${encodeURIComponent('Data download request')}&body=${encodeURIComponent('Please send me a copy of my Sniff.in data. My account ID is ' + (session?.user.id ?? '') + '.')}`,
    ).catch(() => toast.info(`No email app found. Write to ${env.supportEmail} with your account ID.`));

  const requestPhone = async () => {
    const phone = e164Phone(phoneCountry, phoneLocal);
    if (!phone) return toast.info('Enter a valid phone number and country code.');
    setPhoneBusy(true);
    try {
      const methods = await authApi.availableMethods();
      if (!methods.phone) { toast.info('Phone sign-in is not active yet. SMS delivery must be configured first.'); return; }
      await authApi.requestPhoneLink(phone);
      setPhonePending(phone);
      toast.info(`A verification code was sent to ${phone}.`);
    } catch (e) { toast.error(e); }
    finally { setPhoneBusy(false); }
  };

  const confirmPhone = async () => {
    if (!phonePending || !/^\d{6}$/.test(phoneCode)) return toast.info('Enter the six-digit code.');
    setPhoneBusy(true);
    try {
      await authApi.verifyPhoneLink(phonePending, phoneCode);
      setPhonePending(null); setPhoneCode(''); setPhoneLocal('');
      toast.success('Phone linked. You can now sign in with this number.');
    } catch (e) { toast.error(e); }
    finally { setPhoneBusy(false); }
  };

  const onDelete = async () => {
    if (!ready) return;
    const ok = await confirm({
      title: 'Delete your account permanently?',
      message: 'This cannot be undone. Everything listed on this screen is deleted from Sniff.in.',
      confirmLabel: 'Delete my account',
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await authApi.deleteAccount();
      // The auth listener clears the session and the app returns to the welcome screen.
      toast.success('Your account was deleted');
    } catch (e) {
      const code = toAppError(e).code;
      toast.error(code === 'unknown' ? "We couldn't delete your account right now. Nothing was deleted. Try again, or contact support." : e);
      setDeleting(false);
    }
  };

  return (
    <Screen header={<AppHeader title="Data & account" />} edges={['top', 'bottom']}>
      <ListGroup>
        <ListRow icon="mail-outline" title="Email" subtitle={session?.user.email ?? 'Not available'} chevron={false} />
        <ListRow icon="call-outline" title="Phone" subtitle={session?.user.phone || 'Not linked'} chevron={false} />
      </ListGroup>

      <SectionHeader title="Sign-in methods" />
      <Card style={{ gap: 10 }}>
        <Text variant="subheading">Link your phone</Text>
        <Text variant="callout" color="textSecondary">If you already use email, verify your phone here before signing in with it. This keeps both methods on the same account.</Text>
        {phonePending ? <>
          <TextField label={`Code sent to ${phonePending}`} value={phoneCode} onChangeText={(v) => setPhoneCode(v.replace(/\D/g, ''))} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} />
          <Button title="Verify and link phone" loading={phoneBusy} onPress={() => void confirmPhone()} />
          <Button title="Change number" variant="ghost" onPress={() => setPhonePending(null)} />
        </> : <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ width: 82 }}><TextField label="Code" value={phoneCountry} onChangeText={setPhoneCountry} keyboardType="phone-pad" maxLength={4} /></View>
            <View style={{ flex: 1 }}><TextField label="Phone number" value={phoneLocal} onChangeText={setPhoneLocal} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" /></View>
          </View>
          <Button title={session?.user.phone ? 'Change linked phone' : 'Send verification code'} variant="secondary" loading={phoneBusy} onPress={() => void requestPhone()} />
        </>}
      </Card>

      <SectionHeader title="Your data" />
      <Card style={{ gap: 10 }}>
        <Text variant="subheading">Download my data</Text>
        <Text variant="callout" color="textSecondary">
          There is no in-app export yet. Ask for a copy of your data and include your account ID so support can verify the request. Write to {env.supportEmail}.
        </Text>
        <Button title="Request my data by email" variant="secondary" size="sm" icon="mail-outline" onPress={requestData} />
      </Card>

      <SectionHeader title="Delete account" />
      <Card style={{ gap: 12, borderColor: colors.danger }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Ionicons name="warning-outline" size={22} color={colors.danger} />
          <Text variant="heading" color="danger">
            Delete my account
          </Text>
        </View>
        <Text variant="callout" color="textSecondary">
          This permanently deletes from our database and file storage:
        </Text>
        <View style={{ gap: 6 }}>
          {DELETED.map((d) => (
            <View key={d} style={{ flexDirection: 'row', gap: 8 }}>
              <Text variant="callout" color="textSecondary">
                {'•'}
              </Text>
              <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
                {d}
              </Text>
            </View>
          ))}
        </View>
        <Banner
          tone="warning"
          icon="information-circle-outline"
          title="What stays"
          body="Reports you filed are kept for moderation without your name. Backups from our database provider age out on their schedule (typically within about a week, longer with point-in-time recovery). We can't recall notifications already delivered to a device, or copies other people made."
        />
        <TextField
          label="Type DELETE to confirm"
          value={confirmText}
          onChangeText={setConfirmText}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="DELETE"
          editable={!deleting}
        />
        <Button title="Delete my account" variant="danger" icon="trash-outline" disabled={!ready} loading={deleting} onPress={onDelete} />
      </Card>
    </Screen>
  );
}
