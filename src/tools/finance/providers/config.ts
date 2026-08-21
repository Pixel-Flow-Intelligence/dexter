/** Active finance data providers (Financial Datasets is retained in env but unused). */

export function envOr(name: string, fallback = ''): string {
  return (process.env[name] || fallback).trim();
}

export function fmpConfig() {
  return {
    apiKey: envOr('FMP_API_KEY'),
    baseUrl: envOr('FMP_BASE_URL', 'https://financialmodelingprep.com/stable').replace(/\/+$/, ''),
  };
}

export function siftingConfig() {
  return {
    apiKey: envOr('SIFTING_API_KEY'),
    baseUrl: envOr('SIFTING_BASE_URL', 'https://api.sifting.io').replace(/\/+$/, ''),
  };
}

export function businessQuantConfig() {
  return {
    apiKey: envOr('BUSINESS_QUANT_API_KEY'),
    baseUrl: envOr('BUSINESS_QUANT_BASE_URL', 'https://data.businessquant.com').replace(/\/+$/, ''),
  };
}

export function coingeckoConfig() {
  return {
    apiKey: envOr('COINGECKO_API_KEY'),
    baseUrl: envOr('COINGECKO_BASE_URL', 'https://api.coingecko.com/api/v3').replace(/\/+$/, ''),
  };
}

export function hasKey(value: string): boolean {
  return Boolean(value) && !value.toLowerCase().startsWith('your-');
}
