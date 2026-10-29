import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Alert, Linking } from 'react-native';

import { AppError } from '@/lib/errors';
import { DOCUMENT_TYPES } from '@/lib/upload';

import type { PickedFile } from './chat-media';

/** Explains a denied permission and offers a shortcut to the app's Settings page. */
export function explainPermission(what: string) {
  Alert.alert(
    `${what} access is off`,
    `Sniff.in can't do this without ${what.toLowerCase()} access. You can turn it on in Settings.`,
    [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => {}); } }],
  );
}

export async function pickPhoto(): Promise<PickedFile | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const a = res.canceled ? null : res.assets[0];
  return a ? { uri: a.uri, name: a.fileName, mime: a.mimeType, size: a.fileSize, isImage: true } : null;
}

export async function takePhoto(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    explainPermission('Camera');
    return null;
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  const a = res.canceled ? null : res.assets[0];
  return a ? { uri: a.uri, name: a.fileName, mime: a.mimeType, size: a.fileSize, isImage: true } : null;
}

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export async function pickDocument(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_TYPES, copyToCacheDirectory: true });
  const a = res.canceled ? null : res.assets[0];
  if (!a) return null;
  const ext = (a.name.split('.').pop() ?? '').toLowerCase();
  const mime = a.mimeType && DOCUMENT_TYPES.includes(a.mimeType) ? a.mimeType : (EXT_MIME[ext] ?? a.mimeType ?? null);
  return { uri: a.uri, name: a.name, mime, size: a.size ?? null, isImage: false };
}

/** Foreground-only, one-shot position. Call ONLY after the user explicitly confirmed sharing. */
export async function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    explainPermission('Location');
    return null;
  }
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    throw new AppError('location_unavailable', 'Couldn’t get your location. Check that location services are on and try again.');
  }
}
