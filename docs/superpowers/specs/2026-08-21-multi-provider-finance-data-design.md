# Multi-Provider Finance Data Design

**Date:** 2026-08-21  
**Status:** Approved (approach A)  
**Goal:** Replace Financial Datasets as the active backend for `get_financials`, `get_market_data`, `read_filings`, and `stock_screener` with FMP + SiftingIO (complementary), Business Quant, and CoinGecko. Keep FD env/key present but unused.

## Routing (capability split)

| Capability | Primary | Fallback |
|---|---|---|
| Income / balance / cash / all statements | FMP | Sifting XBRL/ratios |
| Key metrics snapshot + historical | FMP | Sifting ratios |
| Earnings | FMP | Sifting (if available) |
| Segments | FMP revenue segmentation | — |
| Stock quote / historical prices | FMP | Sifting (hist may be paid) |
| Crypto prices | CoinGecko | — |
| News | FMP (if plan allows) else soft-fail / empty with note | Sifting if present |
| Insider trades / names | Sifting | FMP (often paid) |
| Insider ownership / 13D-G / institutional | Sifting ownership | Business Quant |
| Filings list | Sifting | SEC EDGAR submissions (free) |
| Filing section items | Business Quant | SEC document URL + note |
| Screener filters + search | FMP (if plan allows) | Sifting screener / degraded mode |

**Financial Datasets:** code may remain under `providers/financial-datasets.ts` but is **not** registered in the active router.

## Env

```
FMP_API_KEY=
FMP_BASE_URL=https://financialmodelingprep.com/stable
SIFTING_API_KEY=
SIFTING_BASE_URL=https://api.sifting.io
BUSINESS_QUANT_API_KEY=
BUSINESS_QUANT_BASE_URL=https://data.businessquant.com
COINGECKO_API_KEY=
COINGECKO_BASE_URL=https://api.coingecko.com/api/v3
FINANCIAL_DATASETS_API_KEY=  # retained, unused by router
```

All new keys join `DEXTER_OWNED_ENV_KEYS`.

## Architecture

- Keep `api.get` / `api.post` signatures used by existing finance tools.
- Map FD-style paths → capability → provider chain.
- Normalize each provider response into shapes expected by existing formatters (`income_statements`, `snapshot`, `filings`, etc.).
- On total failure, throw with per-provider error summary.

## Probe notes (2026-08-21)

- FMP free: statements, metrics, ratios, segments, earnings, quote, EOD prices OK; screener / news / insider / sec-search often **402**.
- Sifting free: search, filings, insiders, ownership, ratios, XBRL financials OK; historical bars **403**.
- Business Quant key: all probed endpoints **403 unauthorized** — wire anyway; until authorized, fallbacks apply.
- CoinGecko demo key: price + markets OK.

## Non-goals

- Do not rename LLM-facing tools.
- Do not delete FD files/keys.
- Do not require paid FMP/Sifting upgrades in this change.
