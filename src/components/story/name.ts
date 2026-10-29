/** First word of a display name, or null when there is nothing usable. Used to personalise the story. */
export function firstNameOf(displayName: string | null | undefined): string | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^\p{L}\p{M}'’.-]/gu, '');
  if (!clean) return null;
  return clean.length > 20 ? clean.slice(0, 20) : clean;
}
