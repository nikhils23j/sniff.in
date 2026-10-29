import { AppError, isPermanent, toAppError } from '../errors';

describe('toAppError', () => {
  it('parses server RPC "code: message" errors', () => {
    const e = toAppError({ message: 'already_requested: Request already sent' });
    expect(e.code).toBe('already_requested');
    expect(e.message).toBe('Request already sent');
  });
  it('uses friendly copy for bare known codes', () => {
    expect(toAppError({ message: 'rate_limited' }).message).toMatch(/Too many attempts/);
  });
  it('detects network failures and treats them as retryable', () => {
    const e = toAppError(new TypeError('Network request failed'));
    expect(e.code).toBe('network');
    expect(isPermanent(e)).toBe(false);
  });
  it('maps RLS denials to forbidden without leaking SQL', () => {
    const e = toAppError({ message: 'new row violates row-level security policy for table "messages"' });
    expect(e.code).toBe('forbidden');
    expect(e.message).not.toMatch(/messages|policy/);
  });
  it('maps Supabase auth codes', () => {
    expect(toAppError({ message: 'Invalid login credentials', code: 'invalid_credentials' }).code).toBe('invalid_credentials');
  });
  it('never exposes unknown internals', () => {
    const e = toAppError({ message: 'duplicate key value violates unique constraint "x" DETAIL: Key (secret)=(abc)' });
    expect(e.code).toBe('unknown');
    expect(e.message).not.toMatch(/secret|abc/);
  });
  it('keeps bare server codes that have no friendly copy (no more generic "unknown")', () => {
    const e = toAppError({ message: 'media_quota_exceeded' });
    expect(e.code).toBe('media_quota_exceeded');
    expect(isPermanent(e)).toBe(true);
    expect(toAppError({ message: 'some_new_code' }).code).toBe('some_new_code');
  });
  it('maps check violations without leaking SQL', () => {
    const e = toAppError({ code: '23514', message: 'new row for relation "profiles" violates check constraint "x"' });
    expect(e.code).toBe('invalid_input');
    expect(e.message).not.toMatch(/profiles/);
  });
  it('passes AppError through unchanged', () => {
    const original = new AppError('x', 'y');
    expect(toAppError(original)).toBe(original);
  });
});
