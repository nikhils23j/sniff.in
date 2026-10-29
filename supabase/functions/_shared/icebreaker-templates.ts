// Deterministic icebreakers. Shared by the `icebreakers` Edge Function (fallback when no AI provider is
// configured or the provider fails) and by the app (when the function is unreachable).
// Uses ONLY the shared, non-private context returned by public.get_icebreaker_context(). It never
// invents facts: every line is grounded in a field that is present.
// Keep this file dependency-free so it runs in both Deno and React Native.

export type IcebreakerContext = {
  other_name: string;
  shared_tags: { kind: 'interest' | 'hobby' | 'skill' | 'language' | 'career'; name: string }[];
  same_university: string | null;
  their_craving: string | null;
  their_occupation: string | null;
  server_name: string | null;
  ai_allowed?: boolean;
};

const BY_KIND: Record<string, ((t: string) => string)[]> = {
  interest: [
    (t) => `I saw we're both into ${t}—what got you interested in it?`,
    (t) => `What's something about ${t} you've enjoyed lately?`,
  ],
  hobby: [
    (t) => `How did you get into ${t}?`,
    (t) => `What do you enjoy most about ${t}?`,
  ],
  skill: [
    (t) => `I noticed we both know ${t}. What have you been using it for lately?`,
  ],
  career: [
    (t) => `What drew you to ${t}? I'd love to hear about it.`,
  ],
  language: [
    (t) => `We both speak ${t}! What's a phrase you think everyone should know?`,
  ],
};

function openerForTag(kind: string, name: string, seed: number): string {
  const tag = name.trim();
  if (/\bcricket\b/i.test(tag)) {
    return pick([
      "Are you following any cricket matches lately? Which team are you rooting for?",
      "What's the last cricket match you watched that had you on the edge of your seat?",
    ], seed);
  }
  if (/\bchess\b/i.test(tag)) {
    return pick([
      "What's your go-to chess opening? I'm curious what you like about it.",
      "Do you have a favourite chess opening, or do you change it up each game?",
    ], seed);
  }
  if (/\bbadminton\b/i.test(tag)) {
    return pick([
      'Do you play badminton regularly? Singles or doubles?',
      'Where do you usually play badminton? I could use a game sometime.',
    ], seed);
  }
  return pick(BY_KIND[kind] ?? BY_KIND.interest, seed)(tag);
}

/** Stable pseudo-random pick so the same pair sees the same suggestions. */
function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function templateIcebreakers(ctx: IcebreakerContext, max = 3): string[] {
  const out: string[] = [];
  const seed = hash(ctx.other_name + (ctx.server_name ?? ''));
  if (ctx.their_craving) {
    out.push(`I saw you mentioned "${ctx.their_craving}"—what would you like to do together?`);
  }
  const order = ['interest', 'hobby', 'career', 'skill', 'language'];
  const tags = [...ctx.shared_tags].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const t of tags) {
    if (out.length >= max) break;
    out.push(openerForTag(t.kind, t.name, seed + out.length));
  }
  if (out.length < max && ctx.same_university) {
    out.push(`We both know ${ctx.same_university}—what's your favourite spot on campus?`);
  }
  if (out.length < max && ctx.their_occupation) {
    out.push(`What do you enjoy most about your work in ${ctx.their_occupation}?`);
  }
  if (out.length < max && ctx.server_name) {
    out.push(`What brought you to ${ctx.server_name}?`);
  }
  if (out.length === 0) out.push(`Hey ${ctx.other_name}! What's been the best part of your day so far?`);
  return out.slice(0, max);
}
