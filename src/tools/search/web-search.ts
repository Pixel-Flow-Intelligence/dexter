import { DynamicStructuredTool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { WEB_SEARCH_DESCRIPTION } from './index.js';
import { canUseNativeSearch, nativeSearchViaSub2Api } from './native-search.js';
import type { SearchProviderId } from '../../utils/env.js';

export type WebSearchSource = 'auto' | 'native' | 'independent';

export interface WebSearchProvider {
  id: SearchProviderId;
  name: string;
  tool: StructuredToolInterface;
}

export interface NativeSearchAdapter {
  canUse: (model: string) => boolean;
  search: (query: string, model: string) => Promise<string>;
}

const defaultNative: NativeSearchAdapter = {
  canUse: canUseNativeSearch,
  search: nativeSearchViaSub2Api,
};

async function invokeProvider(provider: WebSearchProvider, query: string): Promise<string> {
  const result = await provider.tool.invoke({ query });
  return typeof result === 'string' ? result : JSON.stringify(result);
}

export async function searchWithProviders(
  query: string,
  providers: WebSearchProvider[],
): Promise<string> {
  if (providers.length === 0) {
    throw new Error('[Web Search] No providers configured.');
  }

  const errors: string[] = [];
  for (const provider of providers) {
    try {
      return await invokeProvider(provider, query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider.name}: ${message}`);
    }
  }

  throw new Error(`[Web Search] All providers failed: ${errors.join(' | ')}`);
}

export async function executeWebSearch(args: {
  query: string;
  source?: WebSearchSource;
  model: string;
  providers: WebSearchProvider[];
  native?: NativeSearchAdapter;
}): Promise<string> {
  const source = args.source ?? 'auto';
  const native = args.native ?? defaultNative;
  const tryNative = source !== 'independent' && native.canUse(args.model);

  let nativeError: string | undefined;
  if (tryNative) {
    try {
      return await native.search(args.query, args.model);
    } catch (error) {
      nativeError = error instanceof Error ? error.message : String(error);
      if (source === 'native') {
        throw error instanceof Error ? error : new Error(nativeError);
      }
    }
  } else if (source === 'native') {
    throw new Error('[Native Search] Sub2API native search is not configured for this model.');
  }

  try {
    return await searchWithProviders(args.query, args.providers);
  } catch (error) {
    const independentError = error instanceof Error ? error.message : String(error);
    if (nativeError) {
      throw new Error(`[Web Search] ${nativeError} | ${independentError}`);
    }
    throw error instanceof Error ? error : new Error(independentError);
  }
}

export function createWebSearchTool(
  providers: WebSearchProvider[],
  model: string,
  options?: { native?: NativeSearchAdapter },
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'web_search',
    description: WEB_SEARCH_DESCRIPTION,
    schema: z.object({
      query: z.string().describe('The search query to look up on the web'),
      source: z
        .enum(['auto', 'native', 'independent'])
        .optional()
        .describe(
          'auto (default): current-model native search via Sub2API, then Exa/Tavily fallback. ' +
            'native: Sub2API only. independent: Exa → Perplexity → Tavily → LangSearch only.',
        ),
    }),
    func: async (input) =>
      executeWebSearch({
        query: input.query,
        source: input.source,
        model,
        providers,
        native: options?.native,
      }),
  });
}
