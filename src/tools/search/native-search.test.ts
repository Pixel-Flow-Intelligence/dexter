import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  canUseNativeSearch,
  getNativeSearchToolType,
  nativeSearchViaSub2Api,
} from './native-search.js';

const realFetch = globalThis.fetch;

const ENV_KEYS = ['OPENAI_BASE_URL', 'OPENAI_API_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};

function saveEnv() {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}

function withSub2Api() {
  process.env.OPENAI_BASE_URL = 'https://sub2api.test/v1';
  process.env.OPENAI_API_KEY = 'sk-test';
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function responsesPayload(text: string, citations?: { url: string; title?: string }[]) {
  return {
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: { query: 'test' },
      },
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text,
            annotations: (citations ?? []).map((c) => ({
              type: 'url_citation',
              url: c.url,
              title: c.title,
            })),
          },
        ],
      },
    ],
  };
}

describe('getNativeSearchToolType', () => {
  test('maps OpenAI, Grok, and Claude to web_search', () => {
    expect(getNativeSearchToolType('gpt-5.6-sol')).toBe('web_search');
    expect(getNativeSearchToolType('gpt-4.1')).toBe('web_search');
    expect(getNativeSearchToolType('grok-4')).toBe('web_search');
    expect(getNativeSearchToolType('claude-sonnet-4-5')).toBe('web_search');
  });

  test('maps Gemini to google_search', () => {
    expect(getNativeSearchToolType('gemini-2.5-flash')).toBe('google_search');
  });

  test('returns null for models without native search', () => {
    expect(getNativeSearchToolType('ollama:llama3')).toBeNull();
    expect(getNativeSearchToolType('deepseek-v4-pro')).toBeNull();
    expect(getNativeSearchToolType('kimi-k2.5')).toBeNull();
    expect(getNativeSearchToolType('openrouter:openai/gpt-4o-mini')).toBeNull();
  });
});

describe('canUseNativeSearch', () => {
  beforeEach(() => {
    saveEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  test('requires Sub2API base URL, API key, and a supported model', () => {
    withSub2Api();
    expect(canUseNativeSearch('gpt-5.6-sol')).toBe(true);
    expect(canUseNativeSearch('ollama:llama3')).toBe(false);

    delete process.env.OPENAI_BASE_URL;
    expect(canUseNativeSearch('gpt-5.6-sol')).toBe(false);
  });
});

describe('nativeSearchViaSub2Api', () => {
  beforeEach(() => {
    saveEnv();
    withSub2Api();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    restoreEnv();
  });

  test('posts OpenAI/Grok/Claude searches to /v1/responses with web_search', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return jsonResponse(responsesPayload('Apple reported earnings.', [
        { url: 'https://example.com/aapl', title: 'AAPL earnings' },
      ]));
    }) as typeof fetch;

    for (const model of ['gpt-4.1', 'grok-4', 'claude-sonnet-4-5']) {
      seen.length = 0;
      const result = await nativeSearchViaSub2Api('AAPL earnings', model);
      expect(seen).toHaveLength(1);
      expect(seen[0].url).toBe('https://sub2api.test/v1/responses');
      expect(seen[0].body.model).toBe(model);
      expect(seen[0].body.tools).toEqual([{ type: 'web_search' }]);
      expect(String(seen[0].body.input)).toContain('AAPL earnings');
      expect(result).toContain('Apple reported earnings.');
      expect(result).toContain('https://example.com/aapl');
    }
  });

  test('posts Gemini searches with google_search', async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse(responsesPayload('Top SF news.'));
    }) as typeof fetch;

    await nativeSearchViaSub2Api('San Francisco news', 'gemini-2.5-flash');
    expect(body?.tools).toEqual([{ type: 'google_search' }]);
  });

  test('authorizes with the OpenAI-compatible Sub2API key', async () => {
    let headers: HeadersInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = init?.headers;
      return jsonResponse(responsesPayload('ok'));
    }) as typeof fetch;

    await nativeSearchViaSub2Api('query', 'gpt-4.1');
    const headerBag = new Headers(headers);
    expect(headerBag.get('Authorization')).toBe('Bearer sk-test');
    expect(headerBag.get('Content-Type')).toBe('application/json');
  });

  test('retries gpt-5.6 hosted-tool rejection via /v1/alpha/search', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      if (String(input).endsWith('/responses')) {
        return jsonResponse({ error: { message: 'hosted web_search is not supported' } }, 400);
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model).toBe('gpt-5.6-sol');
      expect(JSON.stringify(body)).toContain('latest CPI');
      return jsonResponse({
        output: 'CPI rose 0.2%.',
        results: [{ title: 'BLS CPI', url: 'https://bls.gov/cpi' }],
      });
    }) as typeof fetch;

    const result = await nativeSearchViaSub2Api('latest CPI', 'gpt-5.6-sol');
    expect(urls).toEqual([
      'https://sub2api.test/v1/responses',
      'https://sub2api.test/v1/alpha/search',
    ]);
    expect(result).toContain('CPI rose 0.2%.');
    expect(result).toContain('https://bls.gov/cpi');
  });

  test('does not use alpha/search for non-gpt-5.6 models', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: { message: 'hosted web_search is not supported' } }, 400)) as unknown as typeof fetch;

    await expect(nativeSearchViaSub2Api('q', 'gpt-4.1')).rejects.toThrow(/native search/i);
  });

  test('extracts Gemini grounding URLs when annotations are absent', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Grounded answer.' }],
          },
        ],
        provider_metadata: {
          google: {
            groundingMetadata: {
              groundingChunks: [{ web: { uri: 'https://news.example/sf', title: 'SF news' } }],
            },
          },
        },
      })) as unknown as typeof fetch;

    const result = await nativeSearchViaSub2Api('sf news', 'gemini-2.5-flash');
    expect(result).toContain('Grounded answer.');
    expect(result).toContain('https://news.example/sf');
  });
});
