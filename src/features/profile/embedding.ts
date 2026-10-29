import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * Best-effort refresh of the caller's semantic-matching vector. The Edge Function itself checks consent,
 * the `semantic_matching` flag and provider configuration, and it deletes the stored vector when consent
 * is off. Failures are ignored on purpose: matching falls back to the deterministic ranking.
 */
export async function refreshProfileEmbedding(): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('embed-profile', { method: 'POST' });
    if (error) logger.info('embed_profile_skipped', { name: String((error as Error).name) });
  } catch (e) {
    logger.info('embed_profile_failed', { name: String((e as Error)?.name) });
  }
}
