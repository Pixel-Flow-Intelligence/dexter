import { providerFetch } from './http.js';

const SEC_UA = 'Dexter Finance Research contact@dexter.local';

type Params = Record<string, string | number | string[] | undefined>;

async function lookupCik(ticker: string): Promise<string> {
  const { data } = await providerFetch(
    'SEC',
    'https://www.sec.gov/files/company_tickers.json',
    { headers: { 'User-Agent': SEC_UA } },
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

export const sec = {
  async filings(params: Params) {
    const ticker = String(params.ticker || '').toUpperCase();
    const cik = await lookupCik(ticker);
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const { data } = await providerFetch('SEC', url, { headers: { 'User-Agent': SEC_UA } });
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
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(accessions[i]).replace(/-/g, '')}/${primary[i] || ''}`,
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
    // Resolve document URL via filings list, then return a stub pointing at SEC HTML.
    const listed = await this.filings({ ticker, filing_type: filingType ? [filingType] : undefined, limit: 50 });
    const match = (listed.data.filings as Array<Record<string, unknown>>).find(
      (f) => String(f.accession_number) === accession,
    );
    const docUrl = match?.url ? String(match.url) : undefined;
    return {
      data: {
        ticker,
        filing_type: filingType,
        accession_number: accession,
        items: [
          {
            name: 'Document',
            title: `${filingType || 'Filing'} primary document`,
            content: docUrl
              ? `Section extraction is unavailable until Business Quant authorizes filing-sections. Primary SEC document: ${docUrl}`
              : `No primary document URL found for ${accession}.`,
            url: docUrl,
          },
        ],
        note: 'Business Quant filing-sections preferred when authorized; SEC EDGAR document URL returned as fallback.',
      },
      url: docUrl || listed.url,
    };
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
