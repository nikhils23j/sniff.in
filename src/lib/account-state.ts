/** In-memory feature state that must be discarded before a different account is rendered. */
const cleaners = new Set<() => void>();

export function registerAccountCleaner(clean: () => void) {
  cleaners.add(clean);
  return () => cleaners.delete(clean);
}

export function clearAccountLocalState() {
  for (const clean of cleaners) clean();
}
