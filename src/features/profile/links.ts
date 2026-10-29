import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

export type SocialKind = 'instagram' | 'linkedin' | 'spotify' | 'website';

const IG_HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const SPOTIFY_URL = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|artist|playlist|show|episode|user)\/([A-Za-z0-9._-]{1,64})(?:[/?#]|$)/i;

/** Profile data is user-written: only ever open well-formed https links. */
export function httpsUrl(u: string | null | undefined): string | null {
  return u && /^https:\/\/[^\s/]+\S*$/i.test(u.trim()) ? u.trim() : null;
}

export function igHandle(h: string | null | undefined): string | null {
  const v = (h ?? '').trim().replace(/^@/, '');
  return IG_HANDLE.test(v) ? v : null;
}

function hostOf(url: string): string {
  return (url.match(/^https:\/\/([^/?#:]+)/i)?.[1] ?? '').toLowerCase();
}

export function linkedinUrl(u: string | null | undefined): string | null {
  const url = httpsUrl(u);
  if (!url) return null;
  const h = hostOf(url);
  return h === 'linkedin.com' || h.endsWith('.linkedin.com') ? url : null;
}

export function spotifyUrl(u: string | null | undefined): string | null {
  const url = httpsUrl(u);
  return url && SPOTIFY_URL.test(url) ? url : null;
}

/** https://open.spotify.com/<type>/<id> → spotify:<type>:<id> */
export function spotifyAppUri(url: string): string | null {
  const m = url.match(SPOTIFY_URL);
  return m ? `spotify:${m[1].toLowerCase()}:${m[2]}` : null;
}

async function inBrowser(url: string): Promise<boolean> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return true;
  } catch {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  }
}

async function tryOpen(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens a social link: native app deep link first (Instagram / Spotify), then the https URL.
 * Returns false if nothing could open it. Never opens a scheme taken directly from profile data.
 */
export async function openSocial(kind: SocialKind, value: string): Promise<boolean> {
  if (kind === 'instagram') {
    const handle = igHandle(value);
    if (!handle) return false;
    if (await tryOpen(`instagram://user?username=${encodeURIComponent(handle)}`)) return true;
    return inBrowser(`https://instagram.com/${handle}`);
  }
  if (kind === 'spotify') {
    const url = spotifyUrl(value);
    if (!url) return false;
    const uri = spotifyAppUri(url);
    if (uri && (await tryOpen(uri))) return true;
    return inBrowser(url);
  }
  if (kind === 'linkedin') {
    const url = linkedinUrl(value);
    if (!url) return false;
    // The OS hands https linkedin.com links to the LinkedIn app when it is installed.
    if (await tryOpen(url)) return true;
    return inBrowser(url);
  }
  const url = httpsUrl(value);
  return url ? inBrowser(url) : false;
}
