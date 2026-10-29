import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Supabase auth storage backed by the iOS Keychain / Android Keystore.
 * SecureStore values are size-limited (~2 KB), and sessions can exceed that, so values are chunked.
 * On web (dev only) falls back to localStorage.
 */
const CHUNK = 1800;
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const safeKey = (key: string) => key.replace(/[^\w.-]/g, '_');

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  const k = safeKey(key);
  const count = await SecureStore.getItemAsync(`${k}.n`, options);
  if (count === null) return null;
  const parts: string[] = [];
  for (let i = 0; i < Number(count); i++) {
    const part = await SecureStore.getItemAsync(`${k}.${i}`, options);
    if (part === null) return null; // partially written → treat as signed out
    parts.push(part);
  }
  return parts.join('');
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') return globalThis.localStorage?.removeItem(key);
  const k = safeKey(key);
  const count = Number((await SecureStore.getItemAsync(`${k}.n`, options)) ?? 0);
  await SecureStore.deleteItemAsync(`${k}.n`, options);
  for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${k}.${i}`, options);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') return globalThis.localStorage?.setItem(key, value);
  const k = safeKey(key);
  await removeItem(key);
  const chunks = Math.ceil(value.length / CHUNK) || 1;
  for (let i = 0; i < chunks; i++) {
    await SecureStore.setItemAsync(`${k}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK), options);
  }
  await SecureStore.setItemAsync(`${k}.n`, String(chunks), options);
}

export const secureSessionStorage = { getItem, setItem, removeItem };
