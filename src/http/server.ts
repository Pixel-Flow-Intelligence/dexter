import { config } from 'dotenv';
import { HeadlessRunner } from '../headless/runner.js';
import type { HeadlessEvent } from '../headless/types.js';
import { parseResearchRequest } from './request.js';

config({ quiet: true });

const encoder = new TextEncoder();

export interface HttpServerOptions {
  host?: string;
  port?: number;
  runner?: HeadlessRunner;
}

export function createHttpServer(options: HttpServerOptions = {}): ReturnType<typeof Bun.serve> {
  const host = options.host ?? process.env.DEXTER_HTTP_HOST ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.DEXTER_HTTP_PORT ?? 8787);
  const runner = options.runner ?? new HeadlessRunner();

  return Bun.serve({
    hostname: host,
    port,
    // SSE requests can legitimately wait longer than Bun's 10-second default
    // while the agent is waiting for an LLM or external tool response.
    idleTimeout: 0,
    fetch: async (request) => handleRequest(request, runner),
  });
}

export function sseEvent(event: HeadlessEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function handleRequest(request: Request, runner: HeadlessRunner): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(request)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return json({ status: 'ok', service: 'dexter-http' });
  }
  if (request.method !== 'POST' || url.pathname !== '/v1/research') {
    return json({ error: 'not found' }, 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'request body must be valid JSON' }, 400);
  }

  let parsed: ReturnType<typeof parseResearchRequest>;
  try {
    parsed = parseResearchRequest(body);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  const abortController = new AbortController();
  request.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runner.run({ ...parsed, signal: abortController.signal })) {
          controller.enqueue(encoder.encode(sseEvent(event)));
          if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') break;
        }
        controller.close();
      } catch (error) {
        controller.enqueue(encoder.encode(`event: failed\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n\n`));
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function json(value: Record<string, unknown>, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isAuthorized(request: Request): boolean {
  const token = process.env.DEXTER_SERVICE_TOKEN?.trim();
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${token}`;
}
