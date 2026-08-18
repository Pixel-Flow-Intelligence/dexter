import { describe, expect, test } from 'bun:test';
import { parseResearchRequest } from './request.js';

describe('parseResearchRequest', () => {
  test('accepts a query and applies the local session default', () => {
    expect(parseResearchRequest({ query: 'Research AAPL' })).toMatchObject({
      query: 'Research AAPL',
      sessionId: 'http-local',
    });
  });

  test('rejects missing or invalid queries', () => {
    expect(() => parseResearchRequest({})).toThrow('query is required');
    expect(() => parseResearchRequest({ query: '   ' })).toThrow('query is required');
    expect(() => parseResearchRequest({ query: 123 })).toThrow('query must be a string');
  });
});
