import {
  businessQuantConfig,
  coingeckoConfig,
  fmpConfig,
  finnhubConfig,
  hasKey,
  siftingConfig,
  secUserAgent,
} from '../tools/finance/providers/config.js';

export type ProviderCategory = 'finance' | 'search' | 'filings';
export type ProviderHealthStatus = 'ok' | 'error' | 'skipped' | 'degraded';

export interface ProviderStatusRow {
  id: string;
  name: string;
  category: ProviderCategory;
  /** Whether Dexter’s active router/search stack uses this provider. */
  active: boolean;
  configured: boolean;
  status: ProviderHealthStatus;
  latency_ms?: number;
  http_status?: number;
  probe?: string;
  usage?: Record<string, unknown> | null;
  usage_note?: string;
  error?: string | null;
}

export interface ProvidersStatusReport {
  checked_at: string;
  summary: {
    ok: number;
    error: number;
    skipped: number;
    degraded: number;
  };
  providers: ProviderStatusRow[];
}

const PROBE_TIMEOUT_MS = 8_000;

type ProbeResult = {
  http_status?: number;
  latency_ms: number;
  ok: boolean;
  degraded?: boolean;
  error?: string;
  usage?: Record<string, unknown> | null;
  usage_note?: string;
  bodyPreview?: string;
};

function envKey(name: string): string {
  return (process.env[name] || '').trim();
}

function isConfigured(value: string): boolean {
  return hasKey(value);
}

async function timedFetch(
  url: string,
  init: RequestInit = {},
): Promise<{ response: Response; text: string; latency_ms: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'DexterFinance/1.0 providers-status',
        ...init.headers,
      },
    });
    const text = await response.text();
    return { response, text, latency_ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function rateLimitUsage(headers: Headers): Record<string, unknown> | null {
  const usage: Record<string, unknown> = {};
  const pairs: Array<[string, string]> = [
    ['x-ratelimit-limit', 'ratelimit_limit'],
    ['x-ratelimit-remaining', 'ratelimit_remaining'],
    ['x-ratelimit-reset', 'ratelimit_reset'],
    ['ratelimit-limit', 'ratelimit_limit'],
    ['ratelimit-remaining', 'ratelimit_remaining'],
    ['ratelimit-reset', 'ratelimit_reset'],
  ];
  for (const [header, key] of pairs) {
    const value = headers.get(header);
    if (value != null) usage[key] = value;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

async function probeFinnhub(): Promise<ProbeResult> {
  const { apiKey, baseUrl } = finnhubConfig();
  if (!isConfigured(apiKey)) {
    return { latency_ms: 0, ok: false, error: 'FINNHUB_API_KEY not configured' };
  }
  const url = `${baseUrl}/quote?symbol=AAPL`;
  const { response, text, latency_ms } = await timedFetch(url, {
    headers: { 'X-Finnhub-Token': apiKey },
  });
  const data = parseJson(text) as { c?: number } | null;
  const ok = response.ok && data != null && typeof data.c === 'number' && data.c > 0;
  return {
    http_status: response.status,
    latency_ms,
    ok,
    usage: rateLimitUsage(response.headers),
    usage_note: 'No public usage API; free tier typically ~60 req/min (429 when exceeded)',
    error: ok ? undefined : text.slice(0, 180) || response.statusText,
  };
}

async function probeFmp(): Promise<ProbeResult> {
  const { apiKey, baseUrl } = fmpConfig();
  if (!isConfigured(apiKey)) {
    return { latency_ms: 0, ok: false, error: 'FMP_API_KEY not configured' };
  }
  const url = `${baseUrl}/quote?symbol=AAPL&apikey=${encodeURIComponent(apiKey)}`;
  const { response, text, latency_ms } = await timedFetch(url);
  const data = parseJson(text);
  const rows = Array.isArray(data) ? data : [];
  const ok = response.ok && rows.length > 0;
  return {
    http_status: response.status,
    latency_ms,
    ok,
    usage: rateLimitUsage(response.headers),
    usage_note: 'No public usage API; check FMP dashboard for daily quota',
    error: ok ? undefined : text.slice(0, 180) || response.statusText,
  };
}

async function probeSifting(): Promise<ProbeResult> {
  const { apiKey, baseUrl } = siftingConfig();
  if (!isConfigured(apiKey)) {
    return { latency_ms: 0, ok: false, error: 'SIFTING_API_KEY not configured' };
  }
  const url = `${baseUrl}/v1/fnd/stocks/search?q=AAPL&limit=1`;
  const { response, text, latency_ms } = await timedFetch(url, {
    headers: { 'X-API-Key': apiKey, 'Accept-Encoding': 'gzip' },
  });
  const ok = response.ok;
  return {
    http_status: response.status,
    latency_ms,
    ok,
    usage: rateLimitUsage(response.headers),
    usage_note: 'No public usage API documented',
    error: ok ? undefined : text.slice(0, 180) || response.statusText,
  };
}

async function probeBusinessQuant(): Promise<ProbeResult> {
  const { apiKey, baseUrl } = businessQuantConfig();
  if (!isConfigured(apiKey)) {
    return { latency_ms: 0, ok: false, error: 'BUSINESS_QUANT_API_KEY not configured' };
  }
  const url = `${baseUrl}/sec-filings?ticker=AAPL&limit=1&api_key=${encodeURIComponent(apiKey)}`;
  const { response, text, latency_ms } = await timedFetch(url);
  if (response.status === 403) {
    return {
      http_status: 403,
      latency_ms,
      ok: false,
      degraded: true,
      usage_note: 'Key present but endpoint unauthorized (common on free/unauthorized plans)',
      error: text.slice(0, 180) || 'forbidden',
    };
  }
  const ok = response.ok;
  return {
    http_status: response.status,
    latency_ms,
    ok,
    usage: rateLimitUsage(response.headers),
    usage_note: 'No public usage API documented',
    error: ok ? undefined : text.slice(0, 180) || response.statusText,
  };
}

async function probeCoinGecko(): Promise<ProbeResult> {
  const { apiKey, baseUrl } = coingeckoConfig();
  if (!isConfigured(apiKey)) {
    return { latency_ms: 0, ok: false, error: 'COINGECKO_API_KEY not configured' };
  }

  const pingUrl = `${baseUrl}/ping?x_cg_demo_api_key=${encodeURIComponent(apiKey)}`;
  const { response, text, latency_ms } = await timedFetch(pingUrl);
  const pingOk = response.ok;

  let usage: Record<string, unknown> | null = rateLimitUsage(response.headers);
  let usageNote =
    'Demo keys: try /key for monthly credits when supported; otherwise check CoinGecko dashboard';

  // Pro `/key` may not work on demo host; attempt best-effort.
  try {
    const keyUrl = `${baseUrl}/key?x_cg_demo_api_key=${encodeURIComponent(apiKey)}`;
    const keyProbe = await timedFetch(keyUrl);
    if (keyProbe.response.ok) {
      const body = parseJson(keyProbe.text);
      if (body && typeof body === 'object') {
        usage = { ...(usage || {}), ...(body as Record<string, unknown>) };
        usageNote = 'CoinGecko /key usage fields when available';
      }
    }
  } catch {
    // ignore secondary usage probe failures
  }

  return {
    http_status: response.status,
    latency_ms,
    ok: pingOk,
    usage,
    usage_note: usageNote,
    error: pingOk ? undefined : text.slice(0, 180) || response.statusText,
  };
}

async function probeSec(): Promise<ProbeResult> {
  const url = 'https://www.sec.gov/files/company_tickers.json';
  const { response, text, latency_ms } = await timedFetch(url, {
    headers: { 'User-Agent': secUserAgent() },
  });
  const data = parseJson(text);
  const ok = response.ok && data != null && typeof data === 'object';
  return {
    http_status: response.status,
    latency_ms,
    ok,
    usage: null,
    usage_note: 'No API key; fair-access User-Agent required',
    error: ok ? undefined : text.slice(0, 180) || response.statusText,
  };
}

async function probeExa(): Promise<ProbeResult> {
  const apiKey = envKey('EXASEARCH_API_KEY');
  if (!isConfigured(apiKey)) {
    return { latency_ms: 0, ok: false, error: 'EXASEARCH_API_KEY not configured' };
  }
  const { response, text, latency_ms } = await timedFetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: 'AAPL stock', numResults: 1, type: 'auto' }),
  });
  const ok = response.ok;
  return {
    http_status: response.status,
    latency_ms,
    ok,
    usage: rateLimitUsage(response.headers),
    usage_note: 'No public usage API in this probe; check Exa dashboard',
    error: ok ? undefined : text.slice(0, 180) || response.statusText,
  };
}

async function probeTavily(): Promise<ProbeResult> {
  const apiKey = envKey('TAVILY_API_KEY');
  if (!isConfigured(apiKey)) {
    return { latency_ms: 0, ok: false, error: 'TAVILY_API_KEY not configured' };
  }
  const { response, text, latency_ms } = await timedFetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query: 'AAPL', max_results: 1 }),
  });
  const ok = response.ok;
  return {
    http_status: response.status,
    latency_ms,
    ok,
    usage: rateLimitUsage(response.headers),
    usage_note: 'No public usage API in this probe; check Tavily dashboard',
    error: ok ? undefined : text.slice(0, 180) || response.statusText,
  };
}

async function probePerplexity(): Promise<ProbeResult> {
  const apiKey = envKey('PERPLEXITY_API_KEY');
  if (!isConfigured(apiKey)) {
    return { latency_ms: 0, ok: false, error: 'PERPLEXITY_API_KEY not configured' };
  }
  const { response, text, latency_ms } = await timedFetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    }),
  });
  const ok = response.ok;
  return {
    http_status: response.status,
    latency_ms,
    ok,
    usage: rateLimitUsage(response.headers),
    usage_note: 'No public usage API in this probe; check Perplexity dashboard',
    error: ok ? undefined : text.slice(0, 180) || response.statusText,
  };
}

async function probeLangSearch(): Promise<ProbeResult> {
  const apiKey = envKey('LANGSEARCH_API_KEY');
  if (!isConfigured(apiKey)) {
    return { latency_ms: 0, ok: false, error: 'LANGSEARCH_API_KEY not configured' };
  }
  const { response, text, latency_ms } = await timedFetch('https://api.langsearch.com/v1/web-search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: 'AAPL', count: 1, summary: false }),
  });
  const ok = response.ok;
  return {
    http_status: response.status,
    latency_ms,
    ok,
    usage: rateLimitUsage(response.headers),
    usage_note: 'No public usage API in this probe; check LangSearch dashboard',
    error: ok ? undefined : text.slice(0, 180) || response.statusText,
  };
}

type ProviderDef = {
  id: string;
  name: string;
  category: ProviderCategory;
  active: boolean;
  configured: () => boolean;
  probe?: string;
  run?: () => Promise<ProbeResult>;
  skippedReason?: string;
  usageNoteWhenSkipped?: string;
};

const PROVIDERS: ProviderDef[] = [
  {
    id: 'finnhub',
    name: 'Finnhub',
    category: 'finance',
    active: true,
    configured: () => isConfigured(finnhubConfig().apiKey),
    probe: 'GET /quote?symbol=AAPL',
    run: probeFinnhub,
  },
  {
    id: 'fmp',
    name: 'Financial Modeling Prep',
    category: 'finance',
    active: true,
    configured: () => isConfigured(fmpConfig().apiKey),
    probe: 'GET /quote?symbol=AAPL',
    run: probeFmp,
  },
  {
    id: 'sifting',
    name: 'SiftingIO',
    category: 'finance',
    active: true,
    configured: () => isConfigured(siftingConfig().apiKey),
    probe: 'GET /v1/fnd/stocks/search?q=AAPL',
    run: probeSifting,
  },
  {
    id: 'business_quant',
    name: 'Business Quant',
    category: 'finance',
    active: true,
    configured: () => isConfigured(businessQuantConfig().apiKey),
    probe: 'GET /sec-filings?ticker=AAPL&limit=1',
    run: probeBusinessQuant,
  },
  {
    id: 'coingecko',
    name: 'CoinGecko',
    category: 'finance',
    active: true,
    configured: () => isConfigured(coingeckoConfig().apiKey),
    probe: 'GET /ping (+ /key usage if available)',
    run: probeCoinGecko,
  },
  {
    id: 'sec',
    name: 'SEC EDGAR',
    category: 'filings',
    active: true,
    configured: () => true,
    probe: 'GET company_tickers.json',
    run: probeSec,
  },
  {
    id: 'exa',
    name: 'Exa',
    category: 'search',
    active: true,
    configured: () => isConfigured(envKey('EXASEARCH_API_KEY')),
    probe: 'POST /search (1 result)',
    run: probeExa,
  },
  {
    id: 'tavily',
    name: 'Tavily',
    category: 'search',
    active: true,
    configured: () => isConfigured(envKey('TAVILY_API_KEY')),
    probe: 'POST /search (1 result)',
    run: probeTavily,
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    category: 'search',
    active: true,
    configured: () => isConfigured(envKey('PERPLEXITY_API_KEY')),
    probe: 'POST /chat/completions (max_tokens=1)',
    run: probePerplexity,
  },
  {
    id: 'langsearch',
    name: 'LangSearch',
    category: 'search',
    active: true,
    configured: () => isConfigured(envKey('LANGSEARCH_API_KEY')),
    probe: 'POST /v1/web-search (count=1)',
    run: probeLangSearch,
  },
  {
    id: 'financial_datasets',
    name: 'Financial Datasets',
    category: 'finance',
    active: false,
    configured: () => isConfigured(envKey('FINANCIAL_DATASETS_API_KEY')),
    skippedReason: 'Retained in env but unused by active finance router',
    usageNoteWhenSkipped: 'Not probed — provider is intentionally inactive',
  },
];

function toRow(def: ProviderDef, result?: ProbeResult): ProviderStatusRow {
  const configured = def.configured();
  if (!def.run || def.skippedReason) {
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      active: def.active,
      configured,
      status: 'skipped',
      probe: def.probe,
      usage: null,
      usage_note: def.usageNoteWhenSkipped || def.skippedReason,
      error: configured ? null : `${def.id} key not configured`,
    };
  }

  if (!configured) {
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      active: def.active,
      configured: false,
      status: 'skipped',
      probe: def.probe,
      usage: null,
      usage_note: result?.usage_note,
      error: result?.error || 'API key not configured',
    };
  }

  const status: ProviderHealthStatus = result?.ok
    ? 'ok'
    : result?.degraded
      ? 'degraded'
      : 'error';

  return {
    id: def.id,
    name: def.name,
    category: def.category,
    active: def.active,
    configured: true,
    status,
    latency_ms: result?.latency_ms,
    http_status: result?.http_status,
    probe: def.probe,
    usage: result?.usage ?? null,
    usage_note: result?.usage_note,
    error: result?.error ?? null,
  };
}

export async function checkProvidersStatus(options?: {
  providers?: string[];
}): Promise<ProvidersStatusReport> {
  const filter = options?.providers?.map((p) => p.trim().toLowerCase()).filter(Boolean);
  const defs = filter && filter.length > 0
    ? PROVIDERS.filter((p) => filter.includes(p.id))
    : PROVIDERS;

  const rows = await Promise.all(
    defs.map(async (def) => {
      if (!def.run || def.skippedReason || !def.configured()) {
        return toRow(def);
      }
      try {
        const result = await def.run();
        return toRow(def, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toRow(def, {
          latency_ms: 0,
          ok: false,
          error: message.slice(0, 200),
          usage_note: 'Probe threw before completion',
        });
      }
    }),
  );

  const summary = { ok: 0, error: 0, skipped: 0, degraded: 0 };
  for (const row of rows) {
    summary[row.status] += 1;
  }

  return {
    checked_at: new Date().toISOString(),
    summary,
    providers: rows,
  };
}
