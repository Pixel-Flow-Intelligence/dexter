import { finnhubConfig, hasKey } from './config.js';
import { providerFetch, ProviderHttpError } from './http.js';

type Params = Record<string, string | number | string[] | undefined>;

function requireKey(): string {
  const { apiKey } = finnhubConfig();
  if (!hasKey(apiKey)) throw new ProviderHttpError('Finnhub', 401, 'FINNHUB_API_KEY is not set');
  return apiKey;
}

function buildUrl(path: string, query: Record<string, string | number | undefined> = {}): string {
  const { baseUrl } = finnhubConfig();
  const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function fhGet(path: string, query: Record<string, string | number | undefined> = {}) {
  // Auth via header only — never put the token in returned source URLs.
  return providerFetch('Finnhub', buildUrl(path, query), {
    headers: { 'X-Finnhub-Token': requireKey() },
  });
}

function defaultNewsWindowDays(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function mapNewsRow(row: Record<string, unknown>, ticker?: string) {
  const ts = Number(row.datetime || 0);
  return {
    title: row.headline ?? row.title,
    date: ts ? new Date(ts * 1000).toISOString() : undefined,
    source: row.source,
    url: row.url,
    summary: row.summary,
    ticker,
  };
}

export const finnhub = {
  async priceSnapshot(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const [{ data: quote, url }, profileRes, metricRes] = await Promise.all([
      fhGet('/quote', { symbol: ticker }),
      fhGet('/stock/profile2', { symbol: ticker }).catch(() => null),
      fhGet('/stock/metric', { symbol: ticker, metric: 'all' }).catch(() => null),
    ]);

    const q = quote as Record<string, number>;
    if (q.c == null || q.c === 0) {
      throw new ProviderHttpError('Finnhub', 404, `No quote for ${ticker}`);
    }

    const profile = (profileRes?.data || {}) as Record<string, unknown>;
    const metric = ((metricRes?.data as { metric?: Record<string, unknown> } | undefined)?.metric ||
      {}) as Record<string, unknown>;

    // Finnhub marketCapitalization is in millions.
    const mcapMillions = Number(profile.marketCapitalization);
    const marketCap = Number.isFinite(mcapMillions) ? mcapMillions * 1_000_000 : undefined;

    return {
      data: {
        snapshot: {
          ticker,
          price: q.c,
          close: q.c,
          day_change: q.d,
          day_change_percent: q.dp,
          volume: metric['10DayAverageTradingVolume']
            ? Number(metric['10DayAverageTradingVolume']) * 1_000_000
            : undefined,
          market_cap: marketCap,
          open: q.o,
          high: q.h,
          low: q.l,
          previous_close: q.pc,
          year_high: metric['52WeekHigh'],
          year_low: metric['52WeekLow'],
          as_of: q.t ? new Date(q.t * 1000).toISOString() : undefined,
          source: 'finnhub',
        },
      },
      url,
    };
  },

  async priceHistory(_params: Params) {
    // Free Finnhub plans typically block /stock/candle — fail fast so FMP can serve history.
    throw new ProviderHttpError(
      'Finnhub',
      403,
      'historical candles unavailable on current Finnhub plan',
    );
  },

  async news(params: Params) {
    const ticker = params.ticker ? String(params.ticker).toUpperCase() : undefined;
    const limit = Number(params.limit ?? 10);
    const window = defaultNewsWindowDays(30);

    if (ticker) {
      const { data, url } = await fhGet('/company-news', {
        symbol: ticker,
        from: params.start_date ? String(params.start_date) : window.from,
        to: params.end_date ? String(params.end_date) : window.to,
      });
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      return {
        data: { news: rows.slice(0, limit).map((row) => mapNewsRow(row, ticker)) },
        url,
      };
    }

    const { data, url } = await fhGet('/news', { category: 'general' });
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    return {
      data: { news: rows.slice(0, limit).map((row) => mapNewsRow(row)) },
      url,
    };
  },

  async insiderTrades(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const limit = Number(params.limit ?? 25);
    const { data, url } = await fhGet('/stock/insider-transactions', { symbol: ticker });
    const rows = ((data as { data?: Record<string, unknown>[] }).data || []) as Record<
      string,
      unknown
    >[];

    const trades = rows.slice(0, limit).map((row) => {
      const shares = Number(row.change);
      const price = Number(row.transactionPrice);
      return {
        ticker: String(row.symbol || ticker),
        name: row.name,
        title: undefined,
        transaction_type: row.transactionCode,
        transaction_shares: Math.abs(shares),
        transaction_price_per_share: price || undefined,
        transaction_value:
          Number.isFinite(shares) && Number.isFinite(price) ? Math.abs(shares) * price : undefined,
        shares_owned_after_transaction: row.share,
        transaction_date: row.transactionDate,
        filing_date: row.filingDate,
        security_title: row.isDerivative ? 'derivative' : 'common stock',
        source: 'finnhub',
      };
    });

    return { data: { insider_trades: trades }, url };
  },

  async searchSymbol(query: string) {
    const { data, url } = await fhGet('/search', { q: query });
    const result = ((data as { result?: Record<string, unknown>[] }).result || []).map((row) => ({
      ticker: row.symbol,
      name: row.description,
      type: row.type,
    }));
    return { data: { tickers: result.map((r) => r.ticker).filter(Boolean), results: result }, url };
  },
};
