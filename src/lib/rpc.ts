import { env } from './env';
import { AppError, toAppError } from './errors';
import { logger } from './logger';
import { supabase } from './supabase';

function ensureConfigured() {
  if (!env.isBackendConfigured) {
    throw new AppError('backend_not_configured', 'Sniff.in is not connected to its backend yet.');
  }
}

/** Calls a Postgres RPC and returns its data, throwing a normalised AppError on failure. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  ensureConfigured();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const appErr = toAppError(error);
    logger.warn('rpc_failed', { fn, code: appErr.code });
    throw appErr;
  }
  return data as T;
}

/** Wraps any Supabase query builder result. */
export async function run<T>(promise: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  ensureConfigured();
  const { data, error } = await promise;
  if (error) throw toAppError(error);
  return data as T;
}
