import { describe, expect, test } from 'bun:test';
import { formatSessionName, resolveAttachTarget, uniqueSessionName } from './session.js';

describe('formatSessionName', () => {
  test('uses dexter-YYYYMMDD-HHMM in local time', () => {
    const date = new Date(2026, 7, 18, 18, 4, 9);
    expect(formatSessionName(date)).toBe('dexter-20260818-1804');
  });
});

describe('uniqueSessionName', () => {
  test('returns the minute name when it is free', () => {
    const date = new Date(2026, 7, 18, 18, 4, 9);
    expect(uniqueSessionName(date, ['dexter-20260818-1803'])).toBe('dexter-20260818-1804');
  });

  test('adds seconds when the minute name is taken', () => {
    const date = new Date(2026, 7, 18, 18, 4, 9);
    expect(uniqueSessionName(date, ['dexter-20260818-1804'])).toBe('dexter-20260818-180409');
  });

  test('adds a numeric suffix when minute and second names are taken', () => {
    const date = new Date(2026, 7, 18, 18, 4, 9);
    expect(
      uniqueSessionName(date, ['dexter-20260818-1804', 'dexter-20260818-180409']),
    ).toBe('dexter-20260818-180409-2');
  });
});

describe('resolveAttachTarget', () => {
  test('attaches to last session when it is still live', () => {
    expect(
      resolveAttachTarget('dexter-20260818-1804', ['dexter-20260818-1750', 'dexter-20260818-1804']),
    ).toEqual({ action: 'attach', session: 'dexter-20260818-1804' });
  });

  test('creates a new session when last session is missing', () => {
    expect(resolveAttachTarget(null, [])).toEqual({ action: 'create' });
  });

  test('creates a new session when last session is dead', () => {
    expect(resolveAttachTarget('dexter-20260818-1804', ['dexter-20260818-1750'])).toEqual({
      action: 'create',
    });
  });
});
