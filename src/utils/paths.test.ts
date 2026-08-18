import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { dexterPath, getDexterDir } from './paths.js';

const ORIGINAL_HOME = process.env.DEXTER_HOME;

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.DEXTER_HOME;
  } else {
    process.env.DEXTER_HOME = ORIGINAL_HOME;
  }
});

describe('getDexterDir', () => {
  test('defaults to .dexter when DEXTER_HOME is unset', () => {
    delete process.env.DEXTER_HOME;
    expect(getDexterDir()).toBe('.dexter');
  });

  test('uses DEXTER_HOME when set', () => {
    process.env.DEXTER_HOME = '.dexter/sessions/dexter-20260818-1804';
    expect(getDexterDir()).toBe('.dexter/sessions/dexter-20260818-1804');
  });

  test('falls back to .dexter when DEXTER_HOME is blank', () => {
    process.env.DEXTER_HOME = '   ';
    expect(getDexterDir()).toBe('.dexter');
  });
});

describe('dexterPath', () => {
  test('joins segments under DEXTER_HOME', () => {
    process.env.DEXTER_HOME = '.dexter/sessions/dexter-20260818-1804';
    expect(dexterPath('scratchpad', 'a.jsonl')).toBe(
      join('.dexter/sessions/dexter-20260818-1804', 'scratchpad', 'a.jsonl'),
    );
  });
});
