import { useEffect, useState } from 'react';

/**
 * Current time as React state, re-rendering every `intervalMs`. Use this instead of calling
 * Date.now() during render, so time-based UI (availability, expiry) updates on its own and stays
 * compatible with the React Compiler's purity rules.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
