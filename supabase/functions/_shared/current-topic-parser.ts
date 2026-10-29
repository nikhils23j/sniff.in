export type CurrentTopic = { suggestion: string; source_url: string; source_title: string; as_of: string };
export type SearchResponse = {
  status?: string;
  output?: ({ type: string; action?: { sources?: { url?: string; title?: string }[] };
    content?: { type: string; text?: string }[] })[];
};

function validUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return null;
    return url.href;
  } catch { return null; }
}

export function parseCurrentTopicResponse(body: SearchResponse, now = Date.now()): CurrentTopic | null {
  if (body.status !== 'completed' || !body.output?.some((x) => x.type === 'web_search_call')) return null;
  const sources = body.output.flatMap((x) => x.type === 'web_search_call' ? x.action?.sources ?? [] : []);
  const raw = body.output.filter((x) => x.type === 'message').flatMap((x) => x.content ?? [])
    .find((x) => x.type === 'output_text')?.text;
  if (!raw) return null;
  let item: { suggestion?: string; source_url?: string; source_title?: string; event_date?: string };
  try { item = JSON.parse(raw); } catch { return null; }
  const suggestion = String(item.suggestion ?? '').trim();
  const eventAt = Date.parse(String(item.event_date ?? ''));
  if (!suggestion || suggestion.length > 140 || !suggestion.includes('?')
    || /\b(ask them|tell them|say hi|you should|you're both)\b/i.test(suggestion)
    || !Number.isFinite(eventAt) || eventAt < now - 48 * 60 * 60_000 || eventAt > now + 36 * 60 * 60_000) return null;
  const url = validUrl(String(item.source_url ?? ''));
  if (!url || !sources.some((s) => validUrl(String(s.url ?? '')) === url)) return null;
  const source = sources.find((s) => validUrl(String(s.url ?? '')) === url);
  return { suggestion, source_url: url, source_title: String(source?.title || item.source_title || new URL(url).hostname).slice(0, 100),
    as_of: new Date(now).toISOString() };
}
