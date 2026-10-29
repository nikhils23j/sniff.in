import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { notificationsApi } from '@/features/social/api';
import { logger } from '@/lib/logger';
import { qk, queryClient } from '@/lib/query-client';

/**
 * Push notifications via the Expo Push Service (which delivers through FCM on Android and APNs on iOS).
 * Requires: a development/production build (not Expo Go), an EAS projectId, FCM V1 credentials uploaded
 * to EAS for Android, and an APNs key for iOS. See docs/PUSH_NOTIFICATIONS.md.
 * Until those exist this is a no-op. In-app notifications work regardless.
 */
let focusedConversationId: string | null = null;
/** The open chat screen registers itself so its own messages don't produce banners/sounds. */
export function setFocusedConversation(id: string | null) {
  focusedConversationId = id;
}

Notifications.setNotificationHandler({
  // Foreground: banners + sound like a normal social app, except for the chat you're already reading.
  handleNotification: async (n) => {
    const conv = (n.request.content.data as Record<string, unknown> | undefined)?.conversation_id;
    const inThisChat = !!conv && conv === focusedConversationId;
    return { shouldShowBanner: !inThisChat, shouldShowList: !inThisChat, shouldPlaySound: !inThisChat, shouldSetBadge: true };
  },
});

export async function getPermissionStatus() {
  return (await Notifications.getPermissionsAsync()).status;
}

export async function requestPushPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

async function registerIfPermitted() {
  if (!Device.isDevice || Platform.OS === 'web') return;
  if (Platform.OS === 'ios' && Constants.expoConfig?.extra?.iosPushEnabled === false) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  const pid = projectId();
  if (!pid) {
    logger.info('push_disabled', { reason: 'no_eas_project_id' });
    return;
  }
  if (Platform.OS === 'android') {
    // Channels let users tune sounds per category in Android settings. PRIVATE hides content on a locked screen.
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 200, 120, 200],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Requests, activity & Servers',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: pid })).data;
  await notificationsApi.registerPushToken(token, Platform.OS as 'ios' | 'android', 'expo');
  registeredToken = token;
}

let registeredToken: string | null = null;

/** Unlinks this device's push token from the signed-in account (call before signing out). */
export async function unregisterThisDevice() {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  await notificationsApi.unregisterPushToken(token);
}

/** Routes a tapped notification to its (authorised) screen. The screen itself re-checks access. */
export function routeForNotification(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const conversationId = data.conversation_id as string | undefined;
  const serverId = data.server_id as string | undefined;
  const postId = data.post_id as string | undefined;
  const type = data.type as string | undefined;
  if (conversationId) router.push(`/chat/${conversationId}`);
  else if (type === 'connection_request') router.push('/requests');
  else if (type === 'request_accepted') router.push('/(tabs)/chats');
  else if (postId) router.push(`/post/${postId}`);
  else if (type === 'activity_response') router.push('/(tabs)/activity');
  else if (type === 'endorsement') router.push('/settings/endorsements');
  else if (type === 'badge_granted') router.push('/(tabs)/me');
  else if (serverId) router.push(`/server/${serverId}`);
  else router.push('/notifications');
}

export function usePushRegistration() {
  useEffect(() => {
    registerIfPermitted().catch((e) => logger.warn('push_register_failed', { name: String((e as Error)?.name) }));
    const handled = new Set<string>();
    const handle = (resp: Notifications.NotificationResponse | null) => {
      if (!resp || handled.has(resp.notification.request.identifier)) return;
      handled.add(resp.notification.request.identifier);
      const data = resp.notification.request.content.data as Record<string, unknown> | undefined;
      // Opening a push counts as reading it, so it doesn't linger as unread in the notification center.
      const notificationId = typeof data?.notification_id === 'string' ? data.notification_id : null;
      if (notificationId) {
        notificationsApi.markRead([notificationId])
          .then(() => queryClient.invalidateQueries({ queryKey: qk.notifications }))
          .catch(() => {});
      }
      routeForNotification(data);
    };
    // A tap that launched the app from a killed state arrives before this listener exists.
    Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    // Tokens can rotate (app reinstall/restore, OS refresh): re-register when that happens.
    const tokenSub = Notifications.addPushTokenListener(() => {
      registerIfPermitted().catch(() => {});
    });
    return () => {
      sub.remove();
      tokenSub.remove();
    };
  }, []);
}

export { registerIfPermitted };
