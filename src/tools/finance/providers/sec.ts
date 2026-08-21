import { providerFetch, providerFetchText } from './http.js';
import { secUserAgent } from './config.js';

type Params = Record<string, string | number | string[] | undefined>;

const MAX_ITEM_CHARS = 48_000;
const MIN_BODY_CHARS = 80;

export type ExtractedFilingItem = {
  name: string;
  title: string;
  content: string;
  url?: string;
};

function uaHeaders(): Record<string, string> {
  return { 'User-Agent': secUserAgent() };
}

async function lookupCik(ticker: string): Promise<string> {
  const { data } = await providerFetch(
    'SEC',
    'https://www.sec.gov/files/company_tickers.json',
    { headers: uaHeaders() },
  );
  const map = data as Record<string, { ticker: string; cik_str: number | string }>;
  const upper = ticker.toUpperCase();
  for (const row of Object.values(map)) {
    if (String(row.ticker).toUpperCase() === upper) {
      return String(row.cik_str).padStart(10, '0');
    }
  }
  throw new Error(`[SEC] CIK not found for ${ticker}`);
}

function accessionNodash(accession: string): string {
  return accession.replace(/-/g, '');
}

function archiveBase(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNodash(accession)}`;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

/** Convert filing HTML to plain text suitable for Item boundary detection. */
export function htmlToPlainText(html: string): string {
  let text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<[^>]+>/g, '\n');
  text = decodeEntities(text);
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{2,}/g, '\n');
  return text;
}

function normalizeItemKey(raw: string): string {
  // "Item-1A" | "Part-1,Item-2" | "1A" | "Item 2.02" -> canonical key without "Item-"
  let s = String(raw).trim();
  s = s.replace(/^Part[-\s]?\d+[,\s]*/i, '');
  s = s.replace(/^Item[-\s]?/i, '');
  return s.replace(/\s+/g, '').toUpperCase();
}

function itemDisplayName(key: string): string {
  return `Item-${key}`;
}

/**
 * Extract Item sections from a 10-K / 10-Q / 8-K plain-text body.
 * TOC rows are skipped by requiring a minimum body length; when an Item
 * appears twice, the last substantial occurrence wins (body over TOC).
 */
export function extractFilingItemsFromText(
  plainText: string,
  options: { maxChars?: number; minBodyChars?: number } = {},
): ExtractedFilingItem[] {
  const maxChars = options.maxChars ?? MAX_ITEM_CHARS;
  const minBody = options.minBodyChars ?? MIN_BODY_CHARS;
  const itemRe = /^\s*Item\s+(\d+[A-Z]?(?:\.\d+)?)\s*[\.\:]\s*(.*)$/gim;
  const matches: Array<{ key: string; title: string; start: number; headerEnd: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(plainText)) !== null) {
    matches.push({
      key: m[1].toUpperCase(),
      title: (m[2] || '').trim().replace(/\s+/g, ' ').slice(0, 160),
      start: m.index,
      headerEnd: m.index + m[0].length,
    });
  }

  const byKey = new Map<string, ExtractedFilingItem>();
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : Math.min(plainText.length, cur.headerEnd + maxChars);
    let body = plainText.slice(cur.headerEnd, end).trim();
    if (body.length < minBody) continue;
    if (body.length > maxChars) {
      body = `${body.slice(0, maxChars)}\n\n[truncated]`;
    }
    byKey.set(cur.key, {
      name: itemDisplayName(cur.key),
      title: cur.title || itemDisplayName(cur.key),
      content: body,
    });
  }

  return Array.from(byKey.values());
}

function filterRequestedItems(
  items: ExtractedFilingItem[],
  requested: string[] | undefined,
): ExtractedFilingItem[] {
  if (!requested || requested.length === 0) return items;
  const want = new Set(requested.map(normalizeItemKey));
  return items.filter((it) => want.has(normalizeItemKey(it.name)));
}

type IndexFile = { name: string; type?: string; size?: string | number };

async function resolvePrimaryDocument(
  cik: string,
  accession: string,
  filingType: string,
): Promise<{ name: string; url: string }> {
  const base = archiveBase(cik, accession);
  const indexUrl = `${base}/index.json`;
  const { data } = await providerFetch('SEC', indexUrl, { headers: uaHeaders() });
  const files = ((data as { directory?: { item?: IndexFile[] } }).directory?.item || []) as IndexFile[];
  const htmlFiles = files.filter((f) => /\.html?$/i.test(f.name));

  const form = filingType.toUpperCase();
  const scored = htmlFiles.map((f) => {
    const name = f.name.toLowerCase();
    const size = Number(f.size || 0);
    let score = size;
    if (name.includes('index')) score -= 1_000_000;
    if (name.includes('exhibit') || /ex[-_]?\d/i.test(name)) score -= 500_000;
    if (form && name.includes(form.toLowerCase().replace(/-/g, ''))) score += 200_000;
    if (form === '10-K' && /10-?k/.test(name)) score += 300_000;
    if (form === '10-Q' && /10-?q/.test(name)) score += 300_000;
    if (form === '8-K' && /8-?k/.test(name)) score += 300_000;
    // Prefer issuer primary docs like aapl-20250927.htm (large, not exhibit).
    if (!name.includes('exhibit') && size > 100_000) score += 100_000;
    return { f, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.f;
  if (!best) {
    throw new Error(`[SEC] no HTML primary document in ${indexUrl}`);
  }
  return { name: best.name, url: `${base}/${best.name}` };
}

/** SEC EDGAR full-text search (EFTS). No API key; User-Agent required. */
export async function eftsSearch(options: {
  q: string;
  forms?: string;
  ciks?: string;
  startdt?: string;
  enddt?: string;
  from?: number;
  size?: number;
}): Promise<{ data: unknown; url: string; hits: Array<Record<string, unknown>> }> {
  const params = new URLSearchParams();
  params.set('q', options.q);
  if (options.forms) params.set('forms', options.forms);
  if (options.ciks) params.set('ciks', options.ciks);
  if (options.startdt && options.enddt) {
    params.set('dateRange', 'custom');
    params.set('startdt', options.startdt);
    params.set('enddt', options.enddt);
  }
  if (options.from != null) params.set('from', String(options.from));
  // EFTS ignores size in some deployments; keep for forward-compat.
  if (options.size != null) params.set('size', String(options.size));

  const url = `https://efts.sec.gov/LATEST/search-index?${params.toString()}`;
  const { data } = await providerFetch('SEC-EFTS', url, { headers: uaHeaders() });
  const hits = ((data as { hits?: { hits?: Array<{ _source?: Record<string, unknown> }> } }).hits?.hits || [])
    .map((h) => h._source || {})
    .filter(Boolean);
  return { data, url, hits };
}

function itemQueryForEfts(itemKey: string): string {
  // Prefer quoted Item labels that appear in filing text.
  const key = itemKey.replace(/^ITEM-?/i, '');
  return `"Item ${key}"`;
}

async function eftsFallbackItems(options: {
  cik: string;
  accession: string;
  filingType: string;
  requested: string[] | undefined;
  docUrl?: string;
}): Promise<ExtractedFilingItem[]> {
  const keys =
    options.requested && options.requested.length > 0
      ? options.requested.map(normalizeItemKey)
      : ['1A', '7', '1'];

  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - 5);
  const startdt = start.toISOString().slice(0, 10);
  const enddt = end.toISOString().slice(0, 10);

  const items: ExtractedFilingItem[] = [];
  for (const key of keys.slice(0, 6)) {
    const { hits, url: searchUrl } = await eftsSearch({
      q: itemQueryForEfts(key),
      forms: options.filingType || undefined,
      ciks: options.cik,
      startdt,
      enddt,
    });
    const match =
      hits.find((h) => String(h.adsh || '') === options.accession) || hits[0];
    if (!match) continue;
    const display = Array.isArray(match.display_names)
      ? String(match.display_names[0] || '')
      : '';
    items.push({
      name: itemDisplayName(key),
      title: `Item ${key} (EFTS match)`,
      content: [
        `EFTS hit for ${itemQueryForEfts(key)}.`,
        display ? `Filer: ${display}` : '',
        `form=${match.form || options.filingType} file_date=${match.file_date || 'n/a'} adsh=${match.adsh || options.accession}`,
        options.docUrl ? `Document: ${options.docUrl}` : '',
        `Search: ${searchUrl}`,
        'Open the primary document URL and locate this Item for full text (EFTS does not return full section bodies).',
      ]
        .filter(Boolean)
        .join('\n'),
      url: options.docUrl,
    });
  }
  return items;
}

export const sec = {
  async filings(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const cik = await lookupCik(ticker);
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const { data } = await providerFetch('SEC', url, { headers: uaHeaders() });
    const recent = (data as { filings?: { recent?: Record<string, unknown[]> } }).filings?.recent;
    if (!recent) return { data: { filings: [] }, url };

    const forms = (recent.form || []) as string[];
    const dates = (recent.filingDate || []) as string[];
    const accessions = (recent.accessionNumber || []) as string[];
    const primary = (recent.primaryDocument || []) as string[];

    let rows = forms.map((form, i) => ({
      ticker,
      filing_type: form,
      filing_date: dates[i],
      accession_number: accessions[i],
      url: `${archiveBase(cik, String(accessions[i]))}/${primary[i] || ''}`,
    }));

    const types = params.filing_type;
    if (Array.isArray(types) && types.length > 0) {
      const set = new Set(types.map((t) => String(t).toUpperCase()));
      rows = rows.filter((r) => set.has(String(r.filing_type).toUpperCase()));
    }

    const limit = Number(params.limit ?? 10);
    return { data: { filings: rows.slice(0, limit) }, url };
  },

  async filingItems(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const accession = String(params.accession_number || '');
    const filingType = String(params.filing_type || '');
    if (!ticker || !accession) {
      throw new Error('[SEC] ticker and accession_number are required for filing items');
    }

    const requested = Array.isArray(params.item)
      ? params.item.map(String)
      : params.item
        ? [String(params.item)]
        : undefined;

    const cik = await lookupCik(ticker);
    let docUrl: string | undefined;
    let items: ExtractedFilingItem[] = [];
    let source = 'sec-edgar-html';

    try {
      const primary = await resolvePrimaryDocument(cik, accession, filingType);
      docUrl = primary.url;
      const { text: html } = await providerFetchText('SEC', docUrl, { headers: uaHeaders() });
      const plain = htmlToPlainText(html);
      items = filterRequestedItems(extractFilingItemsFromText(plain), requested);
      // Attach document URL on each item for citation.
      items = items.map((it) => ({ ...it, url: docUrl }));
    } catch {
      source = 'sec-efts';
    }

    if (items.length === 0) {
      source = 'sec-efts';
      items = await eftsFallbackItems({
        cik,
        accession,
        filingType,
        requested,
        docUrl,
      });
    }

    if (items.length === 0) {
      throw new Error(
        `[SEC] could not extract filing items for ${ticker} ${accession}${docUrl ? ` (${docUrl})` : ''}`,
      );
    }

    return {
      data: {
        ticker,
        filing_type: filingType,
        accession_number: accession,
        items,
        source,
        document_url: docUrl,
      },
      url: docUrl || `https://efts.sec.gov/LATEST/search-index`,
    };
  },

  /** Keyword / form discovery over EDGAR (8-K, 13G, news-like filings). */
  async searchFilings(params: Params) {
    const ticker = params.ticker ? String(params.ticker).toUpperCase() : '';
    const q = String(params.q || params.query || '').trim();
    if (!q) throw new Error('[SEC] searchFilings requires q');

    let ciks: string | undefined;
    if (ticker) {
      ciks = await lookupCik(ticker);
    }

    const end = new Date();
    const start = new Date();
    start.setFullYear(end.getFullYear() - Number(params.years ?? 2));

    const { data, url, hits } = await eftsSearch({
      q,
      forms: params.forms ? String(params.forms) : params.filing_type ? String(params.filing_type) : undefined,
      ciks,
      startdt: start.toISOString().slice(0, 10),
      enddt: end.toISOString().slice(0, 10),
      from: Number(params.from ?? 0),
    });

    const filings = hits.slice(0, Number(params.limit ?? 20)).map((h) => {
      const adsh = String(h.adsh || '');
      const cikNum = Array.isArray(h.ciks) ? String(h.ciks[0] || '').replace(/^0+/, '') : '';
      const file = Array.isArray(h.file_type) ? String(h.file_type[0] || '') : '';
      return {
        ticker: ticker || undefined,
        filing_type: h.form,
        filing_date: h.file_date,
        accession_number: adsh,
        display_names: h.display_names,
        url:
          adsh && cikNum
            ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accessionNodash(adsh)}/${file || ''}`.replace(/\/$/, '')
            : undefined,
      };
    });

    return { data: { filings, total: (data as { hits?: { total?: unknown } }).hits?.total }, url };
  },
};

export const DEFAULT_FILING_ITEM_TYPES = {
  '10-K': [
    { name: 'Item-1', title: 'Business', description: 'Business overview' },
    { name: 'Item-1A', title: 'Risk Factors', description: 'Risk factors' },
    { name: 'Item-7', title: 'MD&A', description: 'Management discussion and analysis' },
    { name: 'Item-8', title: 'Financial Statements', description: 'Financial statements and supplementary data' },
  ],
  '10-Q': [
    { name: 'Part-1,Item-1', title: 'Financial Statements', description: 'Unaudited financial statements' },
    { name: 'Part-1,Item-2', title: 'MD&A', description: 'Management discussion and analysis' },
    { name: 'Part-2,Item-1A', title: 'Risk Factors', description: 'Risk factors' },
  ],
};
