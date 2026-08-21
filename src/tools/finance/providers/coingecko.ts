import { coingeckoConfig, hasKey } from './config.js';
import { providerFetch, ProviderHttpError } from './http.js';

type Params = Record<string, string | number | string[] | undefined>;

const SYMBOL_TO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  BITCOIN: 'bitcoin',
  ETH: 'ethereum',
  ETHEREUM: 'ethereum',
  SOL: 'solana',
  SOLANA: 'solana',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  XRP: 'ripple',
  BNB: 'binancecoin',
};

function requireKey(): string {
  const { apiKey } = coingeckoConfig();
  if (!hasKey(apiKey)) throw new ProviderHttpError('CoinGecko', 401, 'COINGECKO_API_KEY is not set');
  return apiKey;
}

function normalizeTicker(ticker: string): { id: string; symbol: string; vs: string } {
  const raw = ticker.trim().toUpperCase();
  const [base, quote = 'USD'] = raw.split('-');
  const id = SYMBOL_TO_ID[base] || base.toLowerCase();
  return { id, symbol: base, vs: quote.toLowerCase() };
}

function buildUrl(path: string, query: Record<string, string | number | undefined> = {}): string {
  const { baseUrl } = coingeckoConfig();
  const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
  url.searchParams.set('x_cg_demo_api_key', requireKey());
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export const coingecko = {
  async priceSnapshot(params: Params) {
    const { id, symbol, vs } = normalizeTicker(String(params.ticker || 'BTC-USD'));
    const url = buildUrl('/simple/price', {
      ids: id,
      vs_currencies: vs,
      include_24hr_change: 'true',
      include_24hr_vol: 'true',
      include_market_cap: 'true',
    });
    const { data } = await providerFetch('CoinGecko', url);
    const row = (data as Record<string, Record<string, number>>)[id];
    if (!row) throw new ProviderHttpError('CoinGecko', 404, `No price for ${id}`);
    return {
      data: {
        snapshot: {
          ticker: `${symbol}-${vs.toUpperCase()}`,
          price: row[vs],
          close: row[vs],
          day_change_percent: row[`${vs}_24h_change`],
          volume: row[`${vs}_24h_vol`],
          market_cap: row[`${vs}_market_cap`],
        },
      },
      url,
    };
  },

  async priceHistory(params: Params) {
    const { id, symbol, vs } = normalizeTicker(String(params.ticker || 'BTC-USD'));
    const end = params.end_date ? new Date(String(params.end_date) + 'T00:00:00Z') : new Date();
    const start = params.start_date ? new Date(String(params.start_date) + 'T00:00:00Z') : new Date(end.getTime() - 7 * 86400000);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
    const url = buildUrl(`/coins/${id}/market_chart`, {
      vs_currency: vs,
      days,
    });
    const { data } = await providerFetch('CoinGecko', url);
    const prices = ((data as { prices?: [number, number][] }).prices || []).map(([ts, price]) => ({
      time: new Date(ts).toISOString().slice(0, 10),
      date: new Date(ts).toISOString().slice(0, 10),
      close: price,
      open: price,
      high: price,
      low: price,
      volume: null,
      ticker: `${symbol}-${vs.toUpperCase()}`,
    }));
    return { data: { prices }, url };
  },

  async tickers() {
    const url = buildUrl('/coins/markets', {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: 50,
      page: 1,
    });
    const { data } = await providerFetch('CoinGecko', url);
    const tickers = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) =>
      `${String(row.symbol || '').toUpperCase()}-USD`);
    return { data: { tickers }, url };
  },
};
