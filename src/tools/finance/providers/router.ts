import { fmp } from './fmp.js';
import { sifting } from './sifting.js';
import { coingecko } from './coingecko.js';
import { businessQuant } from './business-quant.js';
import { sec } from './sec.js';
import { finnhub } from './finnhub.js';
import { withFallback } from './http.js';

export interface ApiResponse {
  data: Record<string, unknown>;
  url: string;
}

type Params = Record<string, string | number | string[] | undefined>;

function wrap(result: { data: unknown; url: string }): ApiResponse {
  const data = (result.data && typeof result.data === 'object'
    ? result.data
    : { value: result.data }) as Record<string, unknown>;
  return { data, url: result.url };
}

/**
 * Map legacy Financial Datasets-style paths onto capability-split providers.
 * FD itself is intentionally not called.
 */
export async function routeGet(
  endpoint: string,
  params: Params,
): Promise<ApiResponse> {
  const path = endpoint.replace(/\/+$/, '') || '/';

  // --- get_financials ---
  if (path === '/financials/income-statements') {
    return withFallback('income-statements', [
      { name: 'FMP', run: async () => wrap(await fmp.incomeStatements(params)) },
      { name: 'Sifting', run: async () => wrap(await sifting.ratios(params)) },
    ]);
  }
  if (path === '/financials/balance-sheets') {
    return withFallback('balance-sheets', [
      { name: 'FMP', run: async () => wrap(await fmp.balanceSheets(params)) },
    ]);
  }
  if (path === '/financials/cash-flow-statements') {
    return withFallback('cash-flow-statements', [
      { name: 'FMP', run: async () => wrap(await fmp.cashFlowStatements(params)) },
    ]);
  }
  if (path === '/financials') {
    return withFallback('all-financials', [
      { name: 'FMP', run: async () => wrap(await fmp.allFinancials(params)) },
    ]);
  }
  if (path === '/financials/segments') {
    return withFallback('segments', [
      { name: 'FMP', run: async () => wrap(await fmp.segments(params)) },
      {
        name: 'BusinessQuant',
        run: async () => wrap(await businessQuant.financialStatements({ ...params, statement: 'IS' })),
      },
    ]);
  }
  if (path === '/financial-metrics/snapshot') {
    return withFallback('metrics-snapshot', [
      { name: 'FMP', run: async () => wrap(await fmp.metricsSnapshot(params)) },
      { name: 'Sifting', run: async () => wrap(await sifting.ratios(params)) },
    ]);
  }
  if (path === '/financial-metrics') {
    return withFallback('historical-metrics', [
      { name: 'FMP', run: async () => wrap(await fmp.historicalMetrics(params)) },
    ]);
  }
  if (path === '/earnings') {
    return withFallback('earnings', [
      { name: 'FMP', run: async () => wrap(await fmp.earnings(params)) },
      { name: 'Sifting', run: async () => wrap(await sifting.earnings(params)) },
    ]);
  }

  // --- get_market_data ---
  if (path === '/prices/snapshot') {
    return withFallback('price-snapshot', [
      { name: 'Finnhub', run: async () => wrap(await finnhub.priceSnapshot(params)) },
      { name: 'FMP', run: async () => wrap(await fmp.priceSnapshot(params)) },
    ]);
  }
  if (path === '/prices') {
    return withFallback('price-history', [
      { name: 'FMP', run: async () => wrap(await fmp.priceHistory(params)) },
      { name: 'Finnhub', run: async () => wrap(await finnhub.priceHistory(params)) },
    ]);
  }
  if (path === '/prices/snapshot/tickers') {
    return withFallback('stock-tickers', [
      { name: 'FMP', run: async () => wrap(await fmp.stockTickers()) },
      {
        name: 'Finnhub',
        run: async () => wrap(await finnhub.searchSymbol(String(params.q || params.query || 'AAPL'))),
      },
    ]);
  }
  if (path === '/crypto/prices/snapshot') {
    return withFallback('crypto-snapshot', [
      { name: 'CoinGecko', run: async () => wrap(await coingecko.priceSnapshot(params)) },
    ]);
  }
  if (path === '/crypto/prices') {
    return withFallback('crypto-history', [
      { name: 'CoinGecko', run: async () => wrap(await coingecko.priceHistory(params)) },
    ]);
  }
  if (path === '/crypto/prices/tickers') {
    return withFallback('crypto-tickers', [
      { name: 'CoinGecko', run: async () => wrap(await coingecko.tickers()) },
    ]);
  }
  if (path === '/news') {
    return withFallback('news', [
      { name: 'Finnhub', run: async () => wrap(await finnhub.news(params)) },
      { name: 'FMP', run: async () => wrap(await fmp.news(params)) },
      {
        name: 'Sifting-earnings-8K',
        run: async () => {
          const result = await sifting.earnings(params);
          const earnings = (result.data as { earnings: Array<Record<string, unknown>> }).earnings || [];
          return wrap({
            data: {
              news: earnings.map((e) => ({
                title: e.description || `Earnings/8-K ${e.date}`,
                date: e.date,
                source: 'SEC 8-K via Sifting',
                url: e.url,
              })),
            },
            url: result.url,
          });
        },
      },
    ]);
  }
  if (path === '/insider-trades') {
    return withFallback('insider-trades', [
      { name: 'Finnhub', run: async () => wrap(await finnhub.insiderTrades(params)) },
      { name: 'Sifting', run: async () => wrap(await sifting.insiderTrades(params)) },
      { name: 'BusinessQuant', run: async () => wrap(await businessQuant.insiderTransactions(params)) },
    ]);
  }
  if (path === '/insider-trades/names') {
    return withFallback('insider-names', [
      { name: 'Sifting', run: async () => wrap(await sifting.insiderNames(params)) },
    ]);
  }
  if (path === '/insider-ownership') {
    // Sifting free exposes Form 4 trades more than Form 3/5 ownership; return trades-shaped note.
    return withFallback('insider-ownership', [
      {
        name: 'Sifting',
        run: async () => {
          const trades = await sifting.insiderTrades(params);
          const rows = ((trades.data as { insider_trades: Array<Record<string, unknown>> }).insider_trades || []).map((t) => ({
            name: t.name,
            title: t.title,
            form_type: '4',
            holding_type: 'transaction',
            security_title: t.security_title,
            shares_owned: t.shares_owned_after_transaction,
            filing_date: t.filing_date,
            as_of_date: t.transaction_date,
            direct_or_indirect: 'direct',
          }));
          return wrap({ data: { insider_ownership: rows }, url: trades.url });
        },
      },
    ]);
  }
  if (path === '/institutional-holdings' || path === '/institutional-holdings/investors') {
    return withFallback('institutional-holdings', [
      { name: 'BusinessQuant', run: async () => wrap(await businessQuant.institutionalOwnership(params)) },
      {
        name: 'Sifting-ownership',
        run: async () => {
          const own = await sifting.beneficialOwnership(params);
          return wrap({
            data: {
              institutional_holdings: ((own.data as { beneficial_owners: unknown[] }).beneficial_owners || []).map((row) => {
                const r = row as Record<string, unknown>;
                return {
                  filer_name: r.reporting_person_name ?? r.description,
                  ticker: r.ticker,
                  shares: r.aggregate_amount_beneficially_owned,
                  report_period: r.filing_date,
                  value_usd: null,
                };
              }),
            },
            url: own.url,
          });
        },
      },
    ]);
  }
  if (path === '/beneficial-ownership') {
    return withFallback('beneficial-ownership', [
      { name: 'Sifting', run: async () => wrap(await sifting.beneficialOwnership(params)) },
      {
        name: 'BusinessQuant',
        run: async () => {
          const result = await businessQuant.institutionalOwnership(params);
          return wrap({
            data: { beneficial_owners: (result.data as { data?: unknown }).data ?? result.data },
            url: result.url,
          });
        },
      },
    ]);
  }

  // --- read_filings ---
  if (path === '/filings') {
    return withFallback('filings', [
      { name: 'Sifting', run: async () => wrap(await sifting.filings(params)) },
      { name: 'SEC', run: async () => wrap(await sec.filings(params)) },
      { name: 'FMP', run: async () => wrap(await fmp.filings(params)) },
      { name: 'BusinessQuant', run: async () => wrap(await businessQuant.secFilings(params)) },
    ]);
  }
  if (path === '/filings/items') {
    // SEC EDGAR HTML + EFTS is the working path; BQ filing-sections often 403.
    return withFallback('filing-items', [
      { name: 'SEC', run: async () => wrap(await sec.filingItems(params)) },
      {
        name: 'BusinessQuant',
        run: async () => wrap(await businessQuant.filingSections(params)),
      },
    ]);
  }

  // --- stock_screener ---
  if (path === '/financials/search/screener/filters') {
    return withFallback('screener-filters', [
      { name: 'FMP', run: async () => wrap(await fmp.screenerFilters()) },
    ]);
  }

  throw new Error(`[finance-router] unsupported endpoint: ${endpoint}`);
}

export async function routePost(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const path = endpoint.replace(/\/+$/, '') || '/';

  if (path === '/financials/search/screener') {
    return withFallback('screener-search', [
      { name: 'FMP', run: async () => wrap(await fmp.screenerSearch(body)) },
      {
        name: 'BusinessQuant',
        run: async () => wrap(await businessQuant.screener(body)),
      },
      {
        name: 'FMP-degraded-actives',
        run: async () => {
          // Free FMP often blocks company-screener; return most-actives as a degraded screen.
          const { providerFetch } = await import('./http.js');
          const { fmpConfig, hasKey } = await import('./config.js');
          const { apiKey, baseUrl } = fmpConfig();
          if (!hasKey(apiKey)) throw new Error('FMP_API_KEY missing');
          const url = `${baseUrl}/most-actives?apikey=${apiKey}`;
          const { data } = await providerFetch('FMP', url);
          const results = (Array.isArray(data) ? data : []).slice(0, Number(body.limit ?? 20)).map((row: Record<string, unknown>) => ({
            ticker: row.symbol,
            name: row.name,
            price: row.price,
            change_percent: row.changesPercentage,
            note: 'Degraded screener: FMP company-screener unavailable on current plan; showing most-actives.',
          }));
          return wrap({ data: { results, degraded: true }, url });
        },
      },
    ]);
  }

  throw new Error(`[finance-router] unsupported POST endpoint: ${endpoint}`);
}
