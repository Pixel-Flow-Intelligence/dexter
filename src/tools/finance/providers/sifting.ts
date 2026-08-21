import { siftingConfig, hasKey } from './config.js';
import { providerFetch, ProviderHttpError } from './http.js';

type Params = Record<string, string | number | string[] | undefined>;

function requireKey(): string {
  const { apiKey } = siftingConfig();
  if (!hasKey(apiKey)) throw new ProviderHttpError('Sifting', 401, 'SIFTING_API_KEY is not set');
  return apiKey;
}

function buildUrl(path: string, query: Record<string, string | number | undefined> = {}): string {
  const { baseUrl } = siftingConfig();
  const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function siftGet(path: string, query: Record<string, string | number | undefined> = {}) {
  return providerFetch('Sifting', buildUrl(path, query), {
    headers: {
      'X-API-Key': requireKey(),
      'Accept-Encoding': 'gzip',
    },
  });
}

function asDataArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: Record<string, unknown>[] }).data;
  }
  return [];
}

export const sifting = {
  async searchTicker(query: string) {
    return siftGet('/v1/fnd/stocks/search', { q: query, limit: 5 });
  },

  async ratios(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { data, url } = await siftGet(`/v1/fnd/stocks/${ticker}/ratios`);
    const payload = data as { latest?: Record<string, unknown>; ticker?: string };
    const latest = payload.latest || {};
    return {
      data: {
        snapshot: {
          ticker,
          gross_margin: latest.gross_margin,
          operating_margin: latest.operating_margin,
          net_margin: latest.net_margin,
          return_on_equity: latest.return_on_equity,
          return_on_assets: latest.return_on_assets,
          debt_to_equity: latest.debt_to_equity,
          current_ratio: latest.current_ratio,
          report_period: latest.period_end,
          fiscal_period: latest.fiscal_period
            ? `${latest.fiscal_year}-${latest.fiscal_period}`
            : undefined,
        },
      },
      url,
    };
  },

  async filings(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const limit = Number(params.limit ?? 10);
    const { data, url } = await siftGet(`/v1/fnd/stocks/${ticker}/filings`, { limit: Math.max(limit, 25) });
    let rows = asDataArray(data);
    const types = params.filing_type;
    if (Array.isArray(types) && types.length > 0) {
      const set = new Set(types.map((t) => String(t).toUpperCase()));
      rows = rows.filter((r) => set.has(String(r.form || '').toUpperCase().split('/')[0]));
    } else {
      // Prefer periodic/current reports for research when no filter given
      rows = rows.filter((r) => /^(10-K|10-Q|8-K)/i.test(String(r.form || '')));
    }
    rows = rows.slice(0, limit);
    return {
      data: {
        filings: rows.map((row) => ({
          ticker,
          filing_type: row.form,
          filing_date: row.filed_at,
          report_period: row.period_end,
          accession_number: row.accession,
          url: row.primary_document_url,
          description: row.description,
        })),
      },
      url,
    };
  },

  async insiderTrades(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { data, url } = await siftGet(`/v1/fnd/stocks/${ticker}/insiders`, {
      limit: Number(params.limit ?? 25),
    });
    const trades = asDataArray(data).map((row) => ({
      ticker,
      name: row.reporter,
      title: row.officer_title,
      transaction_type: row.transaction_description ?? row.transaction_code,
      transaction_shares: row.shares,
      transaction_price_per_share: row.price_per_share,
      transaction_value: row.notional_usd,
      shares_owned_after_transaction: row.shares_owned_after,
      transaction_date: row.transaction_date,
      filing_date: row.filed_at,
      security_title: row.security,
    }));
    return { data: { insider_trades: trades }, url };
  },

  async insiderNames(params: Params) {
    const { data, url } = await this.insiderTrades({ ...params, limit: 50 });
    const trades = (data as { insider_trades: Array<{ name?: string }> }).insider_trades || [];
    const names = [...new Set(trades.map((t) => t.name).filter(Boolean))];
    return { data: { names }, url };
  },

  async beneficialOwnership(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { data, url } = await siftGet(`/v1/fnd/stocks/${ticker}/ownership`, {
      limit: Number(params.limit ?? 25),
    });
    const rows = asDataArray(data).map((row) => ({
      ticker,
      form_type: row.form,
      filing_date: row.filed_at,
      accession_number: row.accession,
      url: row.primary_document_url,
      description: row.description,
      type: String(row.form || '').includes('13D') ? '13D' : '13G',
      reporting_person_name: row.description,
    }));
    return { data: { beneficial_owners: rows }, url };
  },

  async earnings(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { data, url } = await siftGet(`/v1/fnd/stocks/${ticker}/earnings`, {
      limit: Number(params.limit ?? 8),
    });
    const earnings = asDataArray(data).map((row) => ({
      ticker,
      date: row.filed_at,
      filing_type: '8-K',
      accession_number: row.accession,
      url: row.primary_document_url,
      items: row.items,
      description: row.description,
    }));
    return { data: { earnings }, url };
  },

  async profile(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    return siftGet(`/v1/fnd/stocks/${ticker}/profile`);
  },
};
