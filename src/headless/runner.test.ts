import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '../agent/types.js';
import { HeadlessRunner } from './runner.js';
import type { HeadlessRunRequest } from './types.js';

const request: HeadlessRunRequest = {
  runId: 'run-1',
  sessionId: 'session-1',
  query: 'Research ACME',
  model: 'gpt-5.6-sol',
  modelProvider: 'openai',
};

function fakeAgent(events: AgentEvent[]) {
  return {
    async *run() {
      yield* events;
    },
  };
}

describe('HeadlessRunner', () => {
  test('emits accepted and completed events with monotonic sequence numbers', async () => {
    const runner = new HeadlessRunner({
      createAgent: async () => fakeAgent([
        { type: 'thinking', message: 'checking sources' },
        { type: 'done', answer: 'report', toolCalls: [], iterations: 1, totalTime: 10 },
      ]),
    });

    const events = await Array.fromAsync(runner.run(request));

    expect(events.map((event) => event.type)).toEqual(['accepted', 'thinking', 'report', 'completed']);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events.at(-1)).toMatchObject({ runId: 'run-1', answer: 'report' });
  });

  test('emits cancelled when the caller aborts the run', async () => {
    const controller = new AbortController();
    const runner = new HeadlessRunner({
      createAgent: async () => ({
        async *run(_query: string, _history: unknown, signal?: AbortSignal) {
          await new Promise<void>((resolve) => {
            signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          return;
        },
      }),
    });

    const stream = runner.run({ ...request, signal: controller.signal });
    await stream.next();
    controller.abort();
    const events = [];
    for await (const event of stream) events.push(event);

    expect(events.at(-1)?.type).toBe('cancelled');
  });
});
