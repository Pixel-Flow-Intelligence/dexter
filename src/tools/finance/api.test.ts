import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { api } from './api.js';

const originalFetch = globalThis.fetch;
let requestedUrls: string[] = [];
let responseQueue: Array<{ status: number; body: unknown }> = [];

beforeEach(() => {
  requestedUrls = [];
  responseQueue = [];
  process.env.FMP_API_KEY = 'test-fmp-key';
  process.env.SIFTING_API_KEY = 'test-sifting-key';
  process.env.COINGECKO_API_KEY = 'test-cg-key';
  globalThis.fetch = (async (url: string | URL | Request) => {
    requestedUrls.push(String(url));
    const next = responseQueue.shift();
    if (!next) throw new Error('unexpected fetch');
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('multi-provider finance api', () => {
  test('routes income statements through FMP and normalizes fields', async () => {
    responseQueue = [{
      status: 200,
      body: [{
        date: '2025-09-27',
        symbol: 'AAPL',
        period: 'FY',
        fiscalYear: '2025',
        reportedCurrency: 'USD',
        revenue: 100,
        operatingIncome: 40,
        netIncome: 30,
        eps: 1.5,
      }],
    }];

    const { data, url } = await api.get('/financials/income-statements/', { ticker: 'AAPL', period: 'annual', limit: 1 });
    const rows = data.income_statements as Array<Record<string, unknown>>;
    expect(rows[0].revenue).toBe(100);
    expect(rows[0].operating_income).toBe(40);
    expect(url).toContain('financialmodelingprep.com');
    expect(requestedUrls[0]).toContain('apikey=test-fmp-key');
  });

  test('falls back to Sifting for filings when primary succeeds', async () => {
    responseQueue = [{
      status: 200,
      body: {
        data: [{
          accession: '0000320193-25-000001',
          form: '10-K',
          filed_at: '2025-10-31',
          primary_document_url: 'https://www.sec.gov/example',
        }],
      },
    }];

    const { data } = await api.get('/filings/', { ticker: 'AAPL', limit: 1 });
    const filings = data.filings as Array<Record<string, unknown>>;
    expect(filings[0].filing_type).toBe('10-K');
    expect(filings[0].accession_number).toBe('0000320193-25-000001');
    expect(requestedUrls[0]).toContain('api.sifting.io');
  });

  test('routes crypto snapshot through CoinGecko', async () => {
    responseQueue = [{
      status: 200,
      body: { bitcoin: { usd: 70000, usd_24h_change: 1.2 } },
    }];

    const { data } = await api.get('/crypto/prices/snapshot/', { ticker: 'BTC-USD' });
    const snapshot = data.snapshot as Record<string, unknown>;
    expect(snapshot.price).toBe(70000);
    expect(requestedUrls[0]).toContain('coingecko.com');
    expect(requestedUrls[0]).toContain('x_cg_demo_api_key=test-cg-key');
  });
});
