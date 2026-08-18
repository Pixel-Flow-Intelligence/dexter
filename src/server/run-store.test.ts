import { describe, expect, test } from 'bun:test';
import { RunStore } from './run-store.js';

describe('RunStore', () => {
  test('replays only events after the acknowledged sequence', () => {
    const store = new RunStore(2);
    store.create('run-1');
    store.append('run-1', { type: 'accepted' });
    store.append('run-1', { type: 'thinking' });
    store.append('run-1', { type: 'completed' });

    expect(store.replay('run-1', 1).map((event) => event.type)).toEqual(['thinking', 'completed']);
    expect(store.replay('run-1', 0).map((event) => event.type)).toEqual(['thinking', 'completed']);
  });

  test('keeps terminal state and ignores duplicate event IDs', () => {
    const store = new RunStore(10);
    store.create('run-1');
    const event = store.append('run-1', { type: 'failed', error: 'upstream' }, 'event-1');
    const duplicate = store.append('run-1', { type: 'completed' }, 'event-1');

    expect(event).toEqual(duplicate);
    expect(store.get('run-1')?.status).toBe('failed');
    expect(store.append('run-1', { type: 'completed' })).toBeNull();
  });
});
