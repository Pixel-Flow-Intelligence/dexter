import { resolveProvider } from '../../providers.js';
import { getOpenAICompatibleBaseUrl } from '../../utils/openai-base-url.js';

export type NativeSearchToolType = 'web_search' | 'google_search';

export interface NativeSearchCitation {
  url: string;
  title?: string;
}

const NATIVE_SEARCH_TIMEOUT_MS = 60_000;
const GPT_56_PREFIX = 'gpt-5.6-';

/**
 * Hosted-tool type for the current model, or null if this family has no
 * native web search through Sub2API.
 */
export function getNativeSearchToolType(model: string): NativeSearchToolType | null {
  const family = resolveProvider(model).id;
  switch (family) {
    case 'openai':
    case 'xai':
    case 'anthropic':
      return 'web_search';
    case 'google':
      return 'google_search';
    default:
      return null;
  }
}

function hasUsableOpenAIKey(): boolean {
  const key = process.env.OPENAI_API_KEY?.trim();
  return Boolean(key && !key.startsWith('your-'));
}

/** True when Sub2API is configured and this model family supports native search. */
export function canUseNativeSearch(model: string): boolean {
  return Boolean(
    getNativeSearchToolType(model) &&
      getOpenAICompatibleBaseUrl() &&
      hasUsableOpenAIKey(),
  );
}

function searchPrompt(query: string): string {
  return (
    'Search the web for the following query and provide a concise, sourced answer. ' +
    'Include source URLs.\n\n' +
    `Query: ${query}`
  );
}

function isGpt56(model: string): boolean {
  return model.startsWith(GPT_56_PREFIX);
}

function isHostedSearchRejected(status: number, body: unknown): boolean {
  if (status === 404) return true;
  if (status < 400) return false;
  const msg = typeof body === 'string' ? body : JSON.stringify(body);
  return /web_search|google_search|hosted|not supported|unknown tool|unsupported tool/i.test(msg);
}

async function postJson(
  url: string,
  body: unknown,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ status: number; payload: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let payload: unknown = raw;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = raw;
  }
  return { status: res.status, payload };
}

function errorMessage(payload: unknown): string {
  if (typeof payload === 'string') return payload.slice(0, 200);
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    const err = rec.error;
    if (typeof err === 'string') return err.slice(0, 200);
    if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
      return err.message.slice(0, 200);
    }
    return JSON.stringify(payload).slice(0, 200);
  }
  return 'unknown error';
}

function pushCitation(out: NativeSearchCitation[], url: unknown, title?: unknown) {
  if (typeof url !== 'string' || !url.trim()) return;
  if (out.some((c) => c.url === url)) return;
  out.push({
    url,
    ...(typeof title === 'string' && title.trim() ? { title } : {}),
  });
}

function walkCitations(value: unknown, out: NativeSearchCitation[]) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) walkCitations(item, out);
    return;
  }
  if (typeof value !== 'object') return;
  const rec = value as Record<string, unknown>;

  if (rec.type === 'url_citation' || typeof rec.url === 'string') {
    pushCitation(out, rec.url, rec.title);
  }
  if (rec.uri || rec.web) {
    const web = rec.web && typeof rec.web === 'object' ? (rec.web as Record<string, unknown>) : rec;
    pushCitation(out, web.uri ?? web.url, web.title);
  }
  if (rec.output) walkCitations(rec.output, out);
  if (rec.content) walkCitations(rec.content, out);
  if (Array.isArray(rec.annotations)) walkCitations(rec.annotations, out);
  if (Array.isArray(rec.sources)) walkCitations(rec.sources, out);
  if (Array.isArray(rec.citations)) walkCitations(rec.citations, out);
  if (Array.isArray(rec.groundingChunks)) walkCitations(rec.groundingChunks, out);
  if (rec.provider_metadata) walkCitations(rec.provider_metadata, out);
  if (rec.google) walkCitations(rec.google, out);
  if (rec.groundingMetadata) walkCitations(rec.groundingMetadata, out);
}

function collectText(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (typeof value !== 'object') return [];
  const rec = value as Record<string, unknown>;
  const chunks: string[] = [];
  if (typeof rec.text === 'string' && rec.text.trim()) chunks.push(rec.text);
  if (typeof rec.output === 'string' && rec.output.trim()) chunks.push(rec.output);
  if (rec.content) chunks.push(...collectText(rec.content));
  if (Array.isArray(rec.output)) chunks.push(...collectText(rec.output));
  return chunks;
}

export function formatNativeSearchResult(text: string, citations: NativeSearchCitation[]): string {
  const trimmed = text.trim();
  if (citations.length === 0) return trimmed;
  const lines = citations.map((c) => (c.title ? `- [${c.title}](${c.url})` : `- ${c.url}`));
  return `${trimmed}\n\nSources:\n${lines.join('\n')}`;
}

export function parseNativeSearchPayload(payload: unknown): { text: string; citations: NativeSearchCitation[] } {
  const citations: NativeSearchCitation[] = [];
  walkCitations(payload, citations);

  const chunks = collectText(payload);
  // Prefer message/output_text over concatenated dumps: join unique non-empty chunks.
  const seen = new Set<string>();
  const uniqueChunks: string[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    uniqueChunks.push(trimmed);
  }
  // If we collected both a short output string and a longer message, keep the longest.
  const text = uniqueChunks.sort((a, b) => b.length - a.length)[0] ?? '';

  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec.results)) {
      for (const item of rec.results) {
        if (item && typeof item === 'object') {
          const r = item as Record<string, unknown>;
          pushCitation(citations, r.url, r.title);
        }
      }
    }
  }

  return { text, citations };
}

async function responsesSearch(
  query: string,
  model: string,
  apiKey: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<{ status: number; payload: unknown }> {
  const toolType = getNativeSearchToolType(model);
  if (!toolType) {
    throw new Error(`[Native Search] Model ${model} does not support native web search.`);
  }
  return postJson(
    `${baseUrl}/responses`,
    {
      model,
      input: searchPrompt(query),
      tools: [{ type: toolType }],
    },
    apiKey,
    signal,
  );
}

async function alphaSearch(
  query: string,
  model: string,
  apiKey: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<{ status: number; payload: unknown }> {
  return postJson(
    `${baseUrl}/alpha/search`,
    {
      id: crypto.randomUUID(),
      model,
      commands: { search_query: [{ q: query }] },
      settings: { external_web_access: true },
    },
    apiKey,
    signal,
  );
}

/**
 * One-shot native web search through Sub2API using the current model's hosted
 * search tool. Throws on failure so the caller can fall back to independent engines.
 */
export async function nativeSearchViaSub2Api(
  query: string,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = getOpenAICompatibleBaseUrl();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const toolType = getNativeSearchToolType(model);
  if (!baseUrl || !apiKey || !toolType) {
    throw new Error('[Native Search] Sub2API native search is not configured for this model.');
  }

  const timeout = AbortSignal.timeout(NATIVE_SEARCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let { status, payload } = await responsesSearch(query, model, apiKey, baseUrl, combined);

  if (!isOk(status) && isGpt56(model) && isHostedSearchRejected(status, payload)) {
    ({ status, payload } = await alphaSearch(query, model, apiKey, baseUrl, combined));
  }

  if (!isOk(status)) {
    throw new Error(`[Native Search] Sub2API ${status}: ${errorMessage(payload)}`);
  }

  const { text, citations } = parseNativeSearchPayload(payload);
  if (!text) {
    throw new Error('[Native Search] Sub2API returned an empty search result.');
  }
  return formatNativeSearchResult(text, citations);
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}
