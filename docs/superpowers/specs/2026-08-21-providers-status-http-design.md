# Design: HTTP providers status endpoint

**Date:** 2026-08-21  
**Status:** Approved (approach A — light parallel probes, HTTP ops only)

## Goal

Expose a single authenticated ops endpoint that reports whether Dexter’s external data providers are configured and reachable, plus usage/quota when a vendor API exposes it.

## Non-goals

- Not an agent/LLM tool
- Not deep multi-endpoint capability matrices
- Not a background polling/cache dashboard
- Do not log or return API keys

## Endpoint

`GET /v1/providers/status`

- Auth: same as other HTTP routes (`Authorization: Bearer $DEXTER_SERVICE_TOKEN`)
- Optional query: `providers=finnhub,fmp,...` to filter by id
- Timeout: ~8s per probe; probes run in parallel

## Response shape

```json
{
  "checked_at": "ISO-8601",
  "summary": { "ok": 5, "error": 1, "skipped": 2, "degraded": 0 },
  "providers": [
    {
      "id": "finnhub",
      "name": "Finnhub",
      "category": "finance",
      "active": true,
      "configured": true,
      "status": "ok|error|skipped|degraded",
      "latency_ms": 120,
      "http_status": 200,
      "probe": "GET /quote?symbol=AAPL",
      "usage": null,
      "usage_note": "No public usage API; free tier ~60 req/min",
      "error": null
    }
  ]
}
```

## Probes (one light call each)

| id | Probe | Usage |
|----|-------|-------|
| finnhub | quote AAPL | none (note rate limit) |
| fmp | quote AAPL | none |
| sifting | ticker search AAPL | none |
| business_quant | light filings/ownership call | none (403 = degraded/error) |
| coingecko | `/ping` + try `/key` | include `/key` fields if available |
| sec | company_tickers.json | n/a (no key) |
| exa / tavily / perplexity / langsearch | 1-result search if key set | none unless headers expose limits |
| financial_datasets | skipped | configured but unused by router |

## Status rules

- `skipped`: key missing, or intentionally unused
- `ok`: HTTP 2xx and payload looks usable
- `degraded`: reachable but capability limited (e.g. 402/403 on paid path that still indicates auth works, when we intentionally treat it as soft)
- `error`: network failure, 401/5xx, empty unexpected body

HTTP response for the ops endpoint itself is always **200** when auth succeeds; individual provider failures are in the payload (so monitors can alert on `summary.error` without conflating Dexter-down with one bad vendor).
