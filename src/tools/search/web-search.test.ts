import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  createWebSearchTool,
  executeWebSearch,
  type WebSearchProvider,
} from './web-search.js';

function stubProvider(name: string, result?: string, error?: string): WebSearchProvider {
  return {
    id: 'exa',
    name,
    tool: new DynamicStructuredTool({
      name: 'web_search',
      description: 'stub',
      schema: z.object({ query: z.string() }),
      func: async () => {
        if (error) throw new Error(error);
        return result ?? `${name} result`;
      },
    }),
  };
}

describe('executeWebSearch', () => {
  test('source=independent skips native search', async () => {
    let nativeCalls = 0;
    const result = await executeWebSearch({
      query: 'AAPL',
      source: 'independent',
      model: 'gpt-5.6-sol',
      providers: [stubProvider('Exa', 'exa hits')],
      native: {
        canUse: () => true,
        search: async () => {
          nativeCalls += 1;
          return 'native answer';
        },
      },
    });
    expect(nativeCalls).toBe(0);
    expect(result).toBe('exa hits');
  });

  test('source=native does not fall back to independent engines', async () => {
    let independentCalls = 0;
    const providers: WebSearchProvider[] = [
      {
        ...stubProvider('Exa'),
        tool: new DynamicStructuredTool({
          name: 'web_search',
          description: 'stub',
          schema: z.object({ query: z.string() }),
          func: async () => {
            independentCalls += 1;
            return 'exa hits';
          },
        }),
      },
    ];

    await expect(
      executeWebSearch({
        query: 'AAPL',
        source: 'native',
        model: 'gpt-5.6-sol',
        providers,
        native: {
          canUse: () => true,
          search: async () => {
            throw new Error('[Native Search] Sub2API 500: boom');
          },
        },
      }),
    ).rejects.toThrow(/Native Search/);
    expect(independentCalls).toBe(0);
  });

  test('source=auto falls back to independent engines after native failure', async () => {
    const result = await executeWebSearch({
      query: 'AAPL',
      source: 'auto',
      model: 'gpt-5.6-sol',
      providers: [stubProvider('Exa', 'exa hits')],
      native: {
        canUse: () => true,
        search: async () => {
          throw new Error('[Native Search] Sub2API 500: boom');
        },
      },
    });
    expect(result).toBe('exa hits');
  });

  test('source=auto uses native result and skips independent engines', async () => {
    let independentCalls = 0;
    const result = await executeWebSearch({
      query: 'AAPL',
      model: 'gpt-5.6-sol',
      providers: [
        {
          ...stubProvider('Exa'),
          tool: new DynamicStructuredTool({
            name: 'web_search',
            description: 'stub',
            schema: z.object({ query: z.string() }),
            func: async () => {
              independentCalls += 1;
              return 'exa hits';
            },
          }),
        },
      ],
      native: {
        canUse: () => true,
        search: async () => 'native answer with citations',
      },
    });
    expect(result).toBe('native answer with citations');
    expect(independentCalls).toBe(0);
  });

  test('combines native and independent errors when both fail', async () => {
    await expect(
      executeWebSearch({
        query: 'AAPL',
        source: 'auto',
        model: 'gpt-5.6-sol',
        providers: [stubProvider('Exa', undefined, 'exa down')],
        native: {
          canUse: () => true,
          search: async () => {
            throw new Error('[Native Search] Sub2API 500: boom');
          },
        },
      }),
    ).rejects.toThrow(/Native Search[\s\S]*Exa/);
  });
});

describe('createWebSearchTool', () => {
  test('accepts a source argument', async () => {
    const tool = createWebSearchTool([stubProvider('Exa', 'exa hits')], 'gpt-5.6-sol', {
      native: {
        canUse: () => true,
        search: async () => 'native answer',
      },
    });
    const independent = await tool.invoke({ query: 'AAPL', source: 'independent' });
    expect(independent).toBe('exa hits');
    const auto = await tool.invoke({ query: 'AAPL' });
    expect(auto).toBe('native answer');
  });
});

describe('getToolRegistry web_search availability', () => {
  const ENV_KEYS = [
    'OPENAI_BASE_URL',
    'OPENAI_API_KEY',
    'EXASEARCH_API_KEY',
    'PERPLEXITY_API_KEY',
    'TAVILY_API_KEY',
    'LANGSEARCH_API_KEY',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test('registers web_search when only Sub2API native search is available', async () => {
    process.env.OPENAI_BASE_URL = 'https://sub2api.test/v1';
    process.env.OPENAI_API_KEY = 'sk-test';
    const { getToolRegistry } = await import('../registry.js');
    const names = getToolRegistry('gpt-5.6-sol').map((t) => t.name);
    expect(names).toContain('web_search');
  });

  test('does not register web_search without native search or independent keys', async () => {
    const { getToolRegistry } = await import('../registry.js');
    const names = getToolRegistry('ollama:llama3').map((t) => t.name);
    expect(names).not.toContain('web_search');
  });
});
