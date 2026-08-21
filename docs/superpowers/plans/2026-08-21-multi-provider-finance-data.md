# Multi-Provider Finance Data Implementation Plan

> **For agentic workers:** Implement task-by-task. FD stays unused.

**Goal:** Route Dexter finance tools through FMP + Sifting + Business Quant + CoinGecko.

**Architecture:** Keep `api.get`/`api.post` API; map FD-style paths to capability router with normalized responses.

**Tech Stack:** TypeScript, Bun, existing finance tools/formatters.

---

### Task 1: Provider HTTP helpers + env
- Add env keys to `env.ts` / `env.example`
- Create `providers/http.ts`, `fmp.ts`, `sifting.ts`, `business-quant.ts`, `coingecko.ts`, `sec.ts`

### Task 2: Capability router + rewrite `api.ts`
- Map endpoints → providers with fallback
- Normalize to FD-like shapes for formatters
- Update `api.test.ts` for router (mock providers or keep pagination only if still used)

### Task 3: Special cases
- Crypto → CoinGecko
- Filings list → Sifting / SEC
- Filing items → BQ or SEC document stub
- Screener → FMP if allowed else degraded static filters + limited universe

### Task 4: Deploy env to local + remote, restart, probe
