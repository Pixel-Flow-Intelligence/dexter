import { describe, expect, test } from 'bun:test';
import { parseRemoteArgs } from './args.js';

describe('remote CLI arguments', () => {
  test('defaults to SSH transport', () => {
    expect(parseRemoteArgs(['--query', '研究英伟达'])).toEqual({
      mode: 'ssh',
      query: '研究英伟达',
      configCommand: undefined,
    });
  });

  test('selects HTTP SSE transport with the http positional mode', () => {
    expect(parseRemoteArgs(['http', '--query', '研究英伟达'])).toEqual({
      mode: 'http',
      query: '研究英伟达',
      configCommand: undefined,
    });
  });

  test('parses configuration commands separately from research queries', () => {
    expect(parseRemoteArgs(['config', 'show'])).toEqual({
      mode: 'ssh',
      query: undefined,
      configCommand: { action: 'show', value: undefined },
    });
  });
});
