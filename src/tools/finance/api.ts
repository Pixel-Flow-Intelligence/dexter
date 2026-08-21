import { readCache, writeCache, describeRequest } from '../../utils/cache.js';
import { routeGet, routePost, type ApiResponse } from './providers/router.js';

export type { ApiResponse };

/**
 * Remove redundant fields from API payloads before they are returned to the LLM.
 * This reduces token usage while preserving the financial metrics needed for analysis.
 */
export function stripFieldsDeep(value: unknown, fields: readonly string[]): unknown {
  const fieldsToStrip = new Set(fields);

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(walk);
    }

    if (!node || typeof node !== 'object') {
      return node;
    }

    const record = node as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(record)) {
      if (fieldsToStrip.has(key)) {
        continue;
      }
      cleaned[key] = walk(child);
    }

    return cleaned;
  }

  return walk(value);
}

/**
 * Shared finance API facade.
 *
 * Endpoints keep the legacy Financial Datasets path shapes so existing tools
 * stay unchanged, but requests are routed to FMP / Sifting / Business Quant /
 * CoinGecko / SEC. Financial Datasets is retained in env only and is not called.
 */
export const api = {
  async get(
    endpoint: string,
    params: Record<string, string | number | string[] | undefined>,
    options?: { cacheable?: boolean; ttlMs?: number },
  ): Promise<ApiResponse> {
    const label = describeRequest(endpoint, params);

    if (options?.cacheable) {
      const cached = readCache(endpoint, params, options.ttlMs);
      if (cached) {
        return cached;
      }
    }

    const result = await routeGet(endpoint, params);

    if (options?.cacheable) {
      writeCache(endpoint, params, result.data, result.url);
    }

    void label;
    return result;
  },

  async post(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<ApiResponse> {
    return routePost(endpoint, body);
  },
};

/** @deprecated Use `api.get` instead */
export const callApi = api.get;
