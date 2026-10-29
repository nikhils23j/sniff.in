/**
 * Incoming links are rewritten before Expo Router matches them.
 *
 * Shareable profile links stay https://<APP_LINK_DOMAIN>/@handle (Android App Links filter on /@, and the web
 * fallback page opens sniffin://@handle), but Expo Router can't treat `@[handle]` as a dynamic segment, so the
 * in-app route is /u/[handle].
 */

// Optional scheme + host (https://domain, sniffin://), an optional slash, then @handle.
const PROFILE_LINK = /^(?:[a-z][a-z0-9+.-]*:\/\/[^/?#@]*)?\/*@([a-z0-9_]{3,20})\/?(?:[?#].*)?$/i;

/** `/@nikhil`, `https://sniffin-navy.vercel.app/@nikhil`, `sniffin://@nikhil` → `/u/nikhil`; anything else unchanged. */
export function rewriteProfilePath(path: string): string {
  const match = path.trim().match(PROFILE_LINK);
  return match ? `/u/${match[1].toLowerCase()}` : path;
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return rewriteProfilePath(path);
  } catch {
    return path;
  }
}
