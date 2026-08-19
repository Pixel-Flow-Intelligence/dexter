import { describe, expect, test } from 'bun:test';
import { loadRemoteConfig, saveRemoteConfig } from './config.js';

describe('remote CLI config', () => {
  test('round trips HTTP URL and service token without changing values', async () => {
    const path = `/tmp/dexter-remote-config-${crypto.randomUUID()}.json`;
    await saveRemoteConfig({ httpUrl: 'https://dexter.example.com', serviceToken: 'secret' }, path);
    expect(await loadRemoteConfig(path)).toEqual({
      httpUrl: 'https://dexter.example.com',
      serviceToken: 'secret',
    });
  });

  test('returns empty config when the file does not exist', async () => {
    expect(await loadRemoteConfig(`/tmp/dexter-missing-${crypto.randomUUID()}.json`)).toEqual({});
  });
});
