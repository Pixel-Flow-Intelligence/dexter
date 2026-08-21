import { afterEach, describe, expect, test } from 'bun:test';
import { createOpenAIEmbeddings, embedSingleQuery } from './embeddings.js';

const ORIGINAL = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
};

afterEach(() => {
  restore('OPENAI_API_KEY');
  restore('OPENAI_BASE_URL');
});

function restore(key: keyof typeof ORIGINAL): void {
  const value = ORIGINAL[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('memory embeddings', () => {
  test('uses the configured OpenAI-compatible base URL', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_BASE_URL = 'https://example.test/v1';
    const embeddings = createOpenAIEmbeddings() as unknown as { clientConfig?: { baseURL?: string } };
    expect(embeddings.clientConfig?.baseURL).toBe('https://example.test/v1');
  });

  test('embedSingleQuery returns null when the embedding client throws', async () => {
    const client = {
      provider: 'openai' as const,
      model: 'text-embedding-3-small',
      embed: async () => {
        throw new TypeError("Cannot read properties of undefined (reading '0')");
      },
    };
    await expect(embedSingleQuery(client, 'btc')).resolves.toBeNull();
  });
});
