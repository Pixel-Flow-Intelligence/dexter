import { fmpConfig, hasKey } from './config.js';
import { providerFetch, ProviderHttpError } from './http.js';

type Params = Record<string, string | number | string[] | undefined>;

function requireKey(): string {
  const { apiKey } = fmpConfig();
  if (!hasKey(apiKey)) throw new ProviderHttpError('FMP', 401, 'FMP_API_KEY is not set');
  return apiKey;
}

function buildUrl(path: string, query: Record<string, string | number | undefined> = {}): string {
  const { baseUrl } = fmpConfig();
  const url = new URL(`${baseUrl}/${path.replace(/^\//, '')}`);
  url.searchParams.set('apikey', requireKey());
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function fmpGet(path: string, query: Record<string, string | number | undefined> = {}) {
  return providerFetch('FMP', buildUrl(path, query));
}

function asArray(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function periodLabel(row: Record<string, unknown>): string {
  const period = String(row.period ?? '');
  const fy = String(row.fiscalYear ?? '');
  if (period === 'FY') return fy ? `FY${fy}` : 'FY';
  if (period.startsWith('Q') && fy) return `${fy}-${period}`;
  return period || fy || String(row.date ?? '');
}

function mapIncome(row: Record<string, unknown>) {
  return {
    ticker: row.symbol,
    report_period: row.date,
    fiscal_period: periodLabel(row),
    period: row.period,
    currency: row.reportedCurrency,
    revenue: row.revenue,
    cost_of_revenue: row.costOfRevenue,
    gross_profit: row.grossProfit,
    operating_income: row.operatingIncome,
    net_income: row.netIncome,
    earnings_per_share: row.eps ?? row.epsdiluted,
    basic_earnings_per_share: row.eps,
    research_and_development: row.researchAndDevelopmentExpenses,
    selling_general_and_administrative: row.sellingGeneralAndAdministrativeExpenses,
  };
}

function mapBalance(row: Record<string, unknown>) {
  return {
    ticker: row.symbol,
    report_period: row.date,
    fiscal_period: periodLabel(row),
    period: row.period,
    currency: row.reportedCurrency,
    total_assets: row.totalAssets,
    total_liabilities: row.totalLiabilities,
    shareholders_equity: row.totalStockholdersEquity ?? row.totalEquity,
    cash_and_equivalents: row.cashAndCashEquivalents,
    short_term_investments: row.shortTermInvestments,
    long_term_debt: row.longTermDebt,
    total_debt: row.totalDebt,
  };
}

function mapCashFlow(row: Record<string, unknown>) {
  return {
    ticker: row.symbol,
    report_period: row.date,
    fiscal_period: periodLabel(row),
    period: row.period,
    currency: row.reportedCurrency,
    net_income: row.netIncome,
    operating_cash_flow: row.operatingCashFlow,
    capital_expenditure: row.capitalExpenditure,
    free_cash_flow: row.freeCashFlow,
    property_plant_and_equipment: row.capitalExpenditure,
  };
}

function fmpPeriod(period?: string): { pathSuffix: string; period?: string } {
  if (period === 'ttm') return { pathSuffix: '-ttm' };
  if (period === 'quarterly') return { pathSuffix: '', period: 'quarter' };
  return { pathSuffix: '', period: 'annual' };
}

export const fmp = {
  async incomeStatements(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { pathSuffix, period } = fmpPeriod(String(params.period || 'annual'));
    const { data, url } = await fmpGet(`income-statement${pathSuffix}`, {
      symbol: ticker,
      period,
      limit: Number(params.limit ?? 4),
    });
    return { data: { income_statements: asArray(data).map(mapIncome) }, url };
  },

  async balanceSheets(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { pathSuffix, period } = fmpPeriod(String(params.period || 'annual'));
    const { data, url } = await fmpGet(`balance-sheet-statement${pathSuffix}`, {
      symbol: ticker,
      period,
      limit: Number(params.limit ?? 4),
    });
    return { data: { balance_sheets: asArray(data).map(mapBalance) }, url };
  },

  async cashFlowStatements(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { pathSuffix, period } = fmpPeriod(String(params.period || 'annual'));
    const { data, url } = await fmpGet(`cash-flow-statement${pathSuffix}`, {
      symbol: ticker,
      period,
      limit: Number(params.limit ?? 4),
    });
    return { data: { cash_flow_statements: asArray(data).map(mapCashFlow) }, url };
  },

  async allFinancials(params: Params) {
    const [inc, bal, cf] = await Promise.all([
      this.incomeStatements(params),
      this.balanceSheets(params),
      this.cashFlowStatements(params),
    ]);
    return {
      data: {
        financials: {
          income_statements: (inc.data as { income_statements: unknown[] }).income_statements,
          balance_sheets: (bal.data as { balance_sheets: unknown[] }).balance_sheets,
          cash_flow_statements: (cf.data as { cash_flow_statements: unknown[] }).cash_flow_statements,
        },
      },
      url: inc.url,
    };
  },

  async metricsSnapshot(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const [metrics, ratios, quote] = await Promise.all([
      fmpGet('key-metrics-ttm', { symbol: ticker }),
      fmpGet('ratios-ttm', { symbol: ticker }),
      fmpGet('quote', { symbol: ticker }),
    ]);
    const m = asArray(metrics.data)[0] || {};
    const r = asArray(ratios.data)[0] || {};
    const q = asArray(quote.data)[0] || {};
    return {
      data: {
        snapshot: {
          ticker,
          market_cap: m.marketCap ?? q.marketCap,
          enterprise_value: m.enterpriseValueTTM,
          price_to_earnings_ratio: r.priceToEarningsRatioTTM ?? m.peRatioTTM,
          price_to_sales_ratio: r.priceToSalesRatioTTM,
          price_to_book_ratio: r.priceToBookRatioTTM,
          earnings_per_share: r.netIncomePerShareTTM ?? m.netIncomePerShareTTM,
          revenue_growth: r.revenueGrowthTTM ?? m.revenueGrowthTTM,
          earnings_growth: r.netIncomeGrowthTTM,
          gross_margin: r.grossProfitMarginTTM,
          operating_margin: r.operatingProfitMarginTTM,
          net_margin: r.netProfitMarginTTM,
          return_on_equity: r.returnOnEquityTTM ?? m.roeTTM,
          return_on_invested_capital: r.returnOnCapitalEmployedTTM ?? m.roicTTM,
          debt_to_equity: r.debtToEquityRatioTTM ?? m.debtToEquityTTM,
          current_ratio: r.currentRatioTTM ?? m.currentRatioTTM,
          price: q.price,
        },
      },
      url: metrics.url,
    };
  },

  async historicalMetrics(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { data, url } = await fmpGet('key-metrics', {
      symbol: ticker,
      period: params.period === 'quarterly' ? 'quarter' : 'annual',
      limit: Number(params.limit ?? 4),
    });
    const rows = asArray(data).map((row) => ({
      ticker,
      report_period: row.date,
      fiscal_period: periodLabel(row),
      price_to_earnings_ratio: row.peRatio,
      earnings_per_share: row.netIncomePerShare,
      revenue_growth: row.revenueGrowth,
      operating_margin: row.operatingProfitMargin,
      return_on_equity: row.roe,
      market_cap: row.marketCap,
      enterprise_value: row.enterpriseValue,
    }));
    return { data: { financial_metrics: rows }, url };
  },

  async earnings(params: Params) {
    const ticker = params.ticker ? String(params.ticker).toUpperCase() : undefined;
    const path = ticker ? 'earnings' : 'earnings-calendar';
    const { data, url } = await fmpGet(path, ticker ? { symbol: ticker, limit: Number(params.limit ?? 8) } : { limit: Number(params.limit ?? 20) });
    const rows = asArray(data).map((row) => ({
      ticker: row.symbol,
      date: row.date,
      eps_actual: row.epsActual,
      eps_estimated: row.epsEstimated,
      revenue_actual: row.revenueActual,
      revenue_estimated: row.revenueEstimated,
    }));
    return { data: { earnings: rows }, url };
  },

  async segments(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { data, url } = await fmpGet('revenue-product-segmentation', { symbol: ticker });
    const rows = asArray(data).map((row) => ({
      ticker: row.symbol,
      report_period: row.date,
      fiscal_period: periodLabel(row),
      segments: row.data,
    }));
    return { data: { segmented_financials: rows }, url };
  },

  async priceSnapshot(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { data, url } = await fmpGet('quote', { symbol: ticker });
    const q = asArray(data)[0];
    if (!q) throw new ProviderHttpError('FMP', 404, `No quote for ${ticker}`);
    return {
      data: {
        snapshot: {
          ticker,
          price: q.price,
          close: q.price,
          day_change: q.change,
          day_change_percent: q.changePercentage,
          volume: q.volume,
          market_cap: q.marketCap,
          open: q.open,
          previous_close: q.previousClose,
          year_high: q.yearHigh,
          year_low: q.yearLow,
        },
      },
      url,
    };
  },

  async priceHistory(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { data, url } = await fmpGet('historical-price-eod/full', {
      symbol: ticker,
      from: params.start_date ? String(params.start_date) : undefined,
      to: params.end_date ? String(params.end_date) : undefined,
    });
    // FMP may return { historical: [...] } or array
    const payload = data as { historical?: Record<string, unknown>[] } | Record<string, unknown>[];
    const rows = Array.isArray(payload) ? payload : asArray(payload.historical);
    const prices = rows.map((row) => ({
      time: row.date,
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close ?? row.price,
      volume: row.volume,
    }));
    return { data: { prices }, url };
  },

  async stockTickers() {
    // Free plan blocks stock-list; use actively-trading if available, else search seed.
    try {
      const { data, url } = await fmpGet('actively-trading-list');
      const tickers = asArray(data).map((r) => r.symbol).filter(Boolean);
      return { data: { tickers }, url };
    } catch {
      const { data, url } = await fmpGet('search-symbol', { query: 'A' });
      return { data: { tickers: asArray(data).map((r) => r.symbol).filter(Boolean) }, url };
    }
  },

  async news(params: Params) {
    const ticker = params.ticker ? String(params.ticker).toUpperCase() : undefined;
    const path = ticker ? 'news/stock' : 'news/stock-latest';
    const { data, url } = await fmpGet(path, ticker
      ? { symbols: ticker, limit: Number(params.limit ?? 5) }
      : { page: 0, limit: Number(params.limit ?? 5) });
    const news = asArray(data).map((row) => ({
      title: row.title,
      date: row.publishedDate ?? row.date,
      source: row.site ?? row.publisher,
      url: row.url,
      ticker,
    }));
    return { data: { news }, url };
  },

  async screenerFilters() {
    return {
      data: {
        metrics: {
          marketCap: { type: 'number', operators: ['gt', 'gte', 'lt', 'lte'] },
          price: { type: 'number', operators: ['gt', 'gte', 'lt', 'lte'] },
          beta: { type: 'number', operators: ['gt', 'gte', 'lt', 'lte'] },
          volume: { type: 'number', operators: ['gt', 'gte', 'lt', 'lte'] },
          dividendYield: { type: 'number', operators: ['gt', 'gte', 'lt', 'lte'] },
          sector: { type: 'string', operators: ['eq', 'in'] },
          industry: { type: 'string', operators: ['eq', 'in'] },
          exchange: { type: 'string', operators: ['eq', 'in'] },
          country: { type: 'string', operators: ['eq', 'in'] },
          isEtf: { type: 'boolean', operators: ['eq'] },
          isActivelyTrading: { type: 'boolean', operators: ['eq'] },
        },
        note: 'FMP company-screener field names (camelCase). Free plans may restrict the live screener endpoint.',
      },
      url: 'fmp:static-screener-filters',
    };
  },

  async screenerSearch(body: Record<string, unknown>) {
    const filters = Array.isArray(body.filters) ? body.filters as Array<Record<string, unknown>> : [];
    const query: Record<string, string | number | undefined> = {
      limit: Number(body.limit ?? 20),
      isActivelyTrading: 'true',
    };
    for (const f of filters) {
      const field = String(f.field || '');
      const op = String(f.operator || '');
      const value = f.value;
      if (!field) continue;
      if (op === 'eq' || op === 'in') {
        query[field] = Array.isArray(value) ? String(value[0]) : (value as string | number);
      } else if (op === 'gt' || op === 'gte') {
        query[`${field}MoreThan`] = value as number;
      } else if (op === 'lt' || op === 'lte') {
        query[`${field}LowerThan`] = value as number;
      }
    }
    const { data, url } = await fmpGet('company-screener', query);
    const results = asArray(data).map((row) => ({
      ticker: row.symbol,
      name: row.companyName,
      market_cap: row.marketCap,
      sector: row.sector,
      industry: row.industry,
      price: row.price,
      beta: row.beta,
      volume: row.volume,
      exchange: row.exchangeShortName ?? row.exchange,
    }));
    return { data: { results }, url };
  },

  async filings(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const { data, url } = await fmpGet('sec-filings-search/symbol', {
      symbol: ticker,
      from: '2020-01-01',
      to: new Date().toISOString().slice(0, 10),
      page: 0,
      limit: Number(params.limit ?? 10),
    });
    let rows = asArray(data);
    const types = params.filing_type;
    if (Array.isArray(types) && types.length > 0) {
      const set = new Set(types.map(String));
      rows = rows.filter((r) => set.has(String(r.type ?? r.formType ?? '')));
    }
    return {
      data: {
        filings: rows.map((row) => {
          const finalLink = typeof row.finalLink === 'string' ? row.finalLink : '';
          const accession = finalLink.match(/\d{10}-\d{2}-\d{6}/)?.[0] ?? row.cik;
          return {
            ticker,
            filing_type: row.type ?? row.formType,
            filing_date: row.fillingDate ?? row.filingDate ?? row.acceptedDate,
            accession_number: accession,
            url: row.finalLink ?? row.link,
          };
        }),
      },
      url,
    };
  },
};
