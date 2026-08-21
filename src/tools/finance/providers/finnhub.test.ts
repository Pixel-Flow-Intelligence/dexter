import { describe, expect, test } from 'bun:test';

describe('finnhub provider wiring', () => {
  test('exports market-data methods used by router', async () => {
    const { finnhub } = await import('./finnhub.js');
    expect(typeof finnhub.priceSnapshot).toBe('function');
    expect(typeof finnhub.news).toBe('function');
    expect(typeof finnhub.insiderTrades).toBe('function');
    expect(typeof finnhub.priceHistory).toBe('function');
  });
});
