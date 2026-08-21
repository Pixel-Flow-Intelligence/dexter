import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { checkProvidersStatus } from './providers-status.js';

const originalFetch = globalThis.fetch;

const KEYS = [
  'FINNHUB_API_KEY',
  'FMP_API_KEY',
  'SIFTING_API_KEY',
  'BUSINESS_QUANT_API_KEY',
  'COINGECKO_API_KEY',
  'EXASEARCH_API_KEY',
  'TAVILY_API_KEY',
  'PERPLEXITY_API_KEY',
  'LANGSEARCH_API_KEY',
  'FINANCIAL_DATASETS_API_KEY',
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

describe('checkProvidersStatus', () => {
  test('marks missing keys as skipped and probes configured providers', async () => {
    process.env.FINNHUB_API_KEY = 'test-finnhub-key';
    process.env.FINANCIAL_DATASETS_API_KEY = 'test-fd-key';

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('finnhub.io') && url.includes('/quote')) {
        return new Response(JSON.stringify({ c: 100, d: 1, dp: 1, h: 101, l: 99, o: 100, pc: 99, t: 1 }), {
          status: 200,
          headers: { 'x-ratelimit-remaining': '59' },
        });
      }
      if (url.includes('sec.gov')) {
        return new Response(JSON.stringify({ '0': { ticker: 'AAPL', cik_str: 320193 } }), { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    }) as unknown as typeof fetch;

    const report = await checkProvidersStatus({
      providers: ['finnhub', 'fmp', 'sec', 'financial_datasets'],
    });

    expect(report.summary.ok).toBe(2); // finnhub + sec
    expect(report.summary.skipped).toBe(2); // fmp missing + financial_datasets unused

    const byId = Object.fromEntries(report.providers.map((p) => [p.id, p]));
    expect(byId.finnhub.status).toBe('ok');
    expect(byId.finnhub.usage?.ratelimit_remaining).toBe('59');
    expect(byId.fmp.status).toBe('skipped');
    expect(byId.sec.status).toBe('ok');
    expect(byId.financial_datasets.status).toBe('skipped');
    expect(byId.financial_datasets.active).toBe(false);
  });

  test('marks business quant 403 as degraded', async () => {
    process.env.BUSINESS_QUANT_API_KEY = 'test-bq-key';
    globalThis.fetch = mock(async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;

    const report = await checkProvidersStatus({ providers: ['business_quant'] });
    expect(report.providers[0]?.status).toBe('degraded');
    expect(report.summary.degraded).toBe(1);
  });
});
