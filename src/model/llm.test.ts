import { describe, expect, test } from 'bun:test';
import { getChatModel } from './llm.js';

describe('OpenAI API routing', () => {
  test('uses the Responses API for the GPT-5.6 family', () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';

    try {
      for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
        const llm = getChatModel(model) as { useResponsesApi?: boolean };
        expect(llm.useResponsesApi).toBe(true);
      }
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  });

  test('uses the configured OpenAI-compatible base URL', () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    const previousBaseUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_BASE_URL = 'https://example.test/v1';

    try {
      const llm = getChatModel('gpt-5.6-sol') as { clientConfig?: { baseURL?: string } };
      expect(llm.clientConfig?.baseURL).toBe('https://example.test/v1');
    } finally {
      if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousApiKey;
      if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previousBaseUrl;
    }
  });
});
