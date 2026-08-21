import { describe, expect, test } from 'bun:test';
import type { HeadlessEvent } from '../headless/types.js';
import { createHttpServer } from './server.js';

async function* events(): AsyncGenerator<HeadlessEvent> {
  yield {
    type: 'accepted',
    runId: 'run-1',
    sequence: 1,
    occurredAt: '2026-08-20T00:00:00.000Z',
  };
  yield {
    type: 'completed',
    runId: 'run-1',
    sequence: 2,
    occurredAt: '2026-08-20T00:00:01.000Z',
    answer: 'done',
  };
}

describe('Node HTTP server', () => {
  test('serves health checks and research events without Bun', async () => {
    const previousToken = process.env.DEXTER_SERVICE_TOKEN;
    process.env.DEXTER_SERVICE_TOKEN = 'test-token';
    const server = createHttpServer({
      host: '127.0.0.1',
      port: 0,
      runner: { run: () => events() } as never,
    });

    await server.start();
    try {
      const baseUrl = `http://${server.hostname}:${server.port}`;
      const headers = { authorization: 'Bearer test-token' };
      const health = await fetch(`${baseUrl}/healthz`, { headers });
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok', service: 'dexter-http' });

      const previousFetch = globalThis.fetch;
      const previousFmp = process.env.FMP_API_KEY;
      delete process.env.FMP_API_KEY;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('127.0.0.1') || url.includes('localhost')) {
          return previousFetch(input, init);
        }
        if (url.includes('sec.gov')) {
          return new Response(JSON.stringify({ '0': { ticker: 'AAPL' } }), { status: 200 });
        }
        return new Response('skip', { status: 401 });
      }) as typeof fetch;
      try {
        const status = await fetch(`${baseUrl}/v1/providers/status?providers=sec,fmp`, { headers });
        expect(status.status).toBe(200);
        const body = await status.json() as {
          providers: Array<{ id: string; status: string }>;
        };
        expect(body.providers.some((p) => p.id === 'sec' && p.status === 'ok')).toBe(true);
        expect(body.providers.some((p) => p.id === 'fmp' && p.status === 'skipped')).toBe(true);
      } finally {
        globalThis.fetch = previousFetch;
        if (previousFmp === undefined) delete process.env.FMP_API_KEY;
        else process.env.FMP_API_KEY = previousFmp;
      }

      const response = await fetch(`${baseUrl}/v1/research`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'test' }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(await response.text()).toContain('event: completed\ndata: {"type":"completed"');
    } finally {
      server.stop(true);
      if (previousToken === undefined) delete process.env.DEXTER_SERVICE_TOKEN;
      else process.env.DEXTER_SERVICE_TOKEN = previousToken;
    }
  });
});
