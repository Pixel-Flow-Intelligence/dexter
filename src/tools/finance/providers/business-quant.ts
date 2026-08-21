import { businessQuantConfig, hasKey } from './config.js';
import { providerFetch, ProviderHttpError } from './http.js';

type Params = Record<string, string | number | string[] | undefined>;

function requireKey(): string {
  const { apiKey } = businessQuantConfig();
  if (!hasKey(apiKey)) {
    throw new ProviderHttpError('BusinessQuant', 401, 'BUSINESS_QUANT_API_KEY is not set');
  }
  return apiKey;
}

function buildUrl(path: string, query: Record<string, string | number | undefined> = {}): string {
  const { baseUrl } = businessQuantConfig();
  const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
  url.searchParams.set('api_key', requireKey());
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Business Quant client. Current API keys may return 403 until endpoints are
 * authorized — callers should keep this behind fallback chains.
 */
export const businessQuant = {
  async financialStatements(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const statement = String(params.statement || 'IS');
    const frequency = params.period === 'quarterly' ? 'Quarter' : 'Annual';
    const url = buildUrl('/financial-statements', {
      ticker,
      statement,
      frequency,
      period: '5y',
    });
    return providerFetch('BusinessQuant', url);
  },

  async filingSections(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const url = buildUrl('/filing-sections', {
      ticker,
      accession: params.accession_number ? String(params.accession_number) : undefined,
      form: params.filing_type ? String(params.filing_type) : undefined,
    });
    const { data } = await providerFetch('BusinessQuant', url);
    return { data: data as Record<string, unknown>, url };
  },

  async secFilings(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const url = buildUrl('/sec-filings', {
      ticker,
      limit: Number(params.limit ?? 10),
    });
    return providerFetch('BusinessQuant', url);
  },

  async insiderTransactions(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const url = buildUrl('/insider-transactions', {
      ticker,
      limit: Number(params.limit ?? 25),
    });
    return providerFetch('BusinessQuant', url);
  },

  async institutionalOwnership(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const url = buildUrl('/institutional-ownership', {
      ticker,
      limit: Number(params.limit ?? 25),
    });
    return providerFetch('BusinessQuant', url);
  },

  async screener(body: Record<string, unknown>) {
    const url = buildUrl('/stock-screener');
    return providerFetch('BusinessQuant', url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, api_key: requireKey() }),
    });
  },
};
