import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyDexterOwnedEnv } from './env.js';

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ENV = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  DEXTER_SERVICE_TOKEN: process.env.DEXTER_SERVICE_TOKEN,
  LANGSMITH_PROJECT: process.env.LANGSMITH_PROJECT,
};

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  restore('OPENAI_API_KEY');
  restore('OPENAI_BASE_URL');
  restore('DEXTER_SERVICE_TOKEN');
  restore('LANGSMITH_PROJECT');
});

function restore(key: keyof typeof ORIGINAL_ENV): void {
  const value = ORIGINAL_ENV[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('applyDexterOwnedEnv', () => {
  test('overrides inherited Admin OpenAI keys from Dexter .env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dexter-owned-env-'));
    writeFileSync(
      join(dir, '.env'),
      [
        'OPENAI_API_KEY=from-dexter',
        'OPENAI_BASE_URL=https://dexter.example/v1',
        'LANGSMITH_PROJECT=dexter',
      ].join('\n'),
    );
    process.env.OPENAI_API_KEY = 'from-admin';
    process.env.OPENAI_BASE_URL = 'https://newapi.admin.example/v1';
    process.env.DEXTER_SERVICE_TOKEN = 'admin-token';
    process.env.LANGSMITH_PROJECT = 'nofx_admin';
    process.chdir(dir);
    try {
      applyDexterOwnedEnv();
      expect(process.env.OPENAI_API_KEY).toBe('from-dexter');
      expect(process.env.OPENAI_BASE_URL).toBe('https://dexter.example/v1');
      expect(process.env.LANGSMITH_PROJECT).toBe('dexter');
      expect(process.env.DEXTER_SERVICE_TOKEN).toBe('admin-token');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not invent keys missing from Dexter .env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dexter-owned-env-empty-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.env'), 'LANGSMITH_TRACING=false\n');
    process.env.OPENAI_API_KEY = 'from-admin';
    process.chdir(dir);
    try {
      applyDexterOwnedEnv();
      expect(process.env.OPENAI_API_KEY).toBe('from-admin');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
