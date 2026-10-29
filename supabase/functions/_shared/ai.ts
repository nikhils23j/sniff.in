// Provider-independent AI layer. Callers ask for capabilities ("short JSON generation", "embeddings");
// the provider is chosen by environment. When nothing is configured, the factory returns null and callers
// MUST use their deterministic fallback. We never pretend AI ran when it didn't.
//
//   AI_PROVIDER=openai      OPENAI_API_KEY=...      AI_MODEL=gpt-5.4-mini (default)
//   AI_PROVIDER=anthropic   ANTHROPIC_API_KEY=...   AI_MODEL=claude-opus-5-5 (default)
//   EMBEDDINGS_PROVIDER=openai  (uses OPENAI_API_KEY)   EMBEDDINGS_MODEL=text-embedding-3-small (default)
//   EMBEDDINGS_PROVIDER=voyage  VOYAGE_API_KEY=...      EMBEDDINGS_MODEL=voyage-3.5 (default)
import Anthropic from 'npm:@anthropic-ai/sdk';

export const EMBEDDING_DIMS = 1024; // must match public.profile_embeddings.embedding

export type JsonSchema = Record<string, unknown>;
type GenerateOpts = { name: string; system: string; prompt: string; schema: JsonSchema; maxTokens?: number };

export interface TextGenerator {
  readonly name: string;
  readonly model: string;
  generateJson<T>(opts: GenerateOpts): Promise<T>;
}

// ---------------------------------------------------------------- OpenAI (Chat Completions + strict JSON schema)
class OpenAIGenerator implements TextGenerator {
  readonly name = 'openai';
  constructor(private apiKey: string, readonly model: string) {}

  async generateJson<T>({ name, system, prompt, schema, maxTokens = 1500 }: GenerateOpts): Promise<T> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        // Short, low-stakes generation: low reasoning effort keeps latency and cost down.
        reasoning_effort: 'low',
        max_completion_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      }),
    });
    if (!res.ok) throw new Error(`ai_http_${res.status}`);
    const body = await res.json() as {
      choices: { finish_reason: string; message: { content: string | null; refusal?: string | null } }[];
    };
    const choice = body.choices?.[0];
    if (!choice || choice.message.refusal) throw new Error('ai_refused');
    if (choice.finish_reason !== 'stop' || !choice.message.content) throw new Error(`ai_incomplete_${choice.finish_reason}`);
    return JSON.parse(choice.message.content) as T;
  }
}

// ---------------------------------------------------------------- Anthropic (alternative provider)
class AnthropicGenerator implements TextGenerator {
  readonly name = 'anthropic';
  private client: Anthropic;
  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
  }

  async generateJson<T>({ system, prompt, schema, maxTokens = 2000 }: GenerateOpts): Promise<T> {
    // Server-side refusal fallback: on a policy decline the API re-runs the request on a fallback model.
    const params = {
      model: this.model,
      max_tokens: maxTokens,
      system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    };
    const response = await this.client.beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (response.stop_reason === 'refusal') throw new Error('ai_refused');
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('ai_empty');
    return JSON.parse(text.text) as T;
  }
}

export function textGenerator(): TextGenerator | null {
  const provider = (Deno.env.get('AI_PROVIDER') ?? '').toLowerCase();
  if (provider === 'openai') {
    const key = Deno.env.get('OPENAI_API_KEY');
    return key ? new OpenAIGenerator(key, Deno.env.get('AI_MODEL') || 'gpt-5.4-mini') : null;
  }
  if (provider === 'anthropic') {
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    return key ? new AnthropicGenerator(key, Deno.env.get('AI_MODEL') || 'claude-opus-5-5') : null;
  }
  return null; // not configured → caller falls back
}

// ---------------------------------------------------------------- embeddings
export interface Embedder {
  readonly name: string;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

class OpenAIEmbedder implements Embedder {
  readonly name = 'openai';
  constructor(private apiKey: string, readonly model: string) {}
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: EMBEDDING_DIMS }),
    });
    if (!res.ok) throw new Error(`embeddings_http_${res.status}`);
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    return body.data.map((d) => d.embedding);
  }
}

class VoyageEmbedder implements Embedder {
  readonly name = 'voyage';
  constructor(private apiKey: string, readonly model: string) {}
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts, model: this.model, input_type: 'document', output_dimension: EMBEDDING_DIMS }),
    });
    if (!res.ok) throw new Error(`embeddings_http_${res.status}`);
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    return body.data.map((d) => d.embedding);
  }
}

export function embedder(): Embedder | null {
  const provider = (Deno.env.get('EMBEDDINGS_PROVIDER') ?? '').toLowerCase();
  if (provider === 'openai') {
    const key = Deno.env.get('OPENAI_API_KEY');
    return key ? new OpenAIEmbedder(key, Deno.env.get('EMBEDDINGS_MODEL') || 'text-embedding-3-small') : null;
  }
  if (provider === 'voyage') {
    const key = Deno.env.get('VOYAGE_API_KEY');
    return key ? new VoyageEmbedder(key, Deno.env.get('EMBEDDINGS_MODEL') || 'voyage-3.5') : null;
  }
  return null;
}
