/**
 * Structured logging with a hard rule: never log message bodies, tokens, emails, passwords or profile
 * fields. Pass only identifiers/codes in `meta`. Swap `sink` for Crashlytics/Sentry when configured.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
type Meta = Record<string, string | number | boolean | null | undefined>;

const REDACT = /(token|password|secret|key|email|body|message|phone)/i;

function scrub(meta?: Meta): Meta | undefined {
  if (!meta) return meta;
  const out: Meta = {};
  for (const [k, v] of Object.entries(meta)) out[k] = REDACT.test(k) ? '[redacted]' : v;
  return out;
}

let sink: (level: Level, event: string, meta?: Meta) => void = (level, event, meta) => {
  if (__DEV__ || level === 'error') {
    console[level === 'debug' ? 'log' : level](`[sniff] ${event}`, meta ?? '');
  }
};

export const logger = {
  setSink(fn: typeof sink) {
    sink = fn;
  },
  debug: (event: string, meta?: Meta) => sink('debug', event, scrub(meta)),
  info: (event: string, meta?: Meta) => sink('info', event, scrub(meta)),
  warn: (event: string, meta?: Meta) => sink('warn', event, scrub(meta)),
  error: (event: string, meta?: Meta) => sink('error', event, scrub(meta)),
};
