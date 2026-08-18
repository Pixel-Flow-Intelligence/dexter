import { describe, expect, test } from 'bun:test';
import { parseRemoteMessage, serializeRemoteMessage } from './protocol.js';

describe('remote CLI protocol', () => {
  test('round trips a query message as JSONL', () => {
    const line = serializeRemoteMessage({ type: 'query', query: 'Analyze ACME' });
    expect(parseRemoteMessage(line)).toEqual({ type: 'query', query: 'Analyze ACME' });
  });

  test('rejects unknown or malformed messages', () => {
    expect(() => parseRemoteMessage('{"type":"unknown"}')).toThrow('Unsupported remote message');
    expect(() => parseRemoteMessage('not-json')).toThrow('Invalid remote message');
  });
});
