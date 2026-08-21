import { config } from 'dotenv';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { HeadlessRunner } from '../headless/runner.js';
import type { HeadlessEvent } from '../headless/types.js';
import { applyDexterOwnedEnv } from '../utils/env.js';
import { parseResearchRequest } from './request.js';
import { checkProvidersStatus } from './providers-status.js';

config({ quiet: true });
applyDexterOwnedEnv();

const encoder = new TextEncoder();

export interface HttpServerOptions {
  host?: string;
  port?: number;
  runner?: HeadlessRunner;
}

export interface HttpServer {
  readonly hostname: string;
  readonly port: number;
  start(): Promise<void>;
  stop(force?: boolean): void;
}

export function createHttpServer(options: HttpServerOptions = {}): HttpServer {
  const host = options.host ?? process.env.DEXTER_HTTP_HOST ?? '127.0.0.1';
  const requestedPort = options.port ?? Number(process.env.DEXTER_HTTP_PORT ?? 8787);
  const runner = options.runner ?? new HeadlessRunner();
  const nodeServer = createServer((request, response) => {
    void handleNodeRequest(request, response, runner);
  });
  // 研究 SSE 可能连续跑数分钟；关掉 Node 默认请求超时，避免对端读到半截 chunked body。
  nodeServer.requestTimeout = 0;
  nodeServer.headersTimeout = 0;
  nodeServer.timeout = 0;

  return {
    hostname: host,
    get port() {
      const address = nodeServer.address();
      return typeof address === 'object' && address ? address.port : requestedPort;
    },
    start: () => new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        nodeServer.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        nodeServer.off('error', onError);
        resolve();
      };
      nodeServer.once('error', onError);
      nodeServer.once('listening', onListening);
      nodeServer.listen(requestedPort, host);
    }),
    stop: (force = false) => {
      if (force) nodeServer.closeAllConnections();
      if (nodeServer.listening) nodeServer.close();
    },
  };
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
  if (request.method === 'GET' && url.pathname === '/v1/providers/status') {
    const filter = url.searchParams.get('providers');
    const providers = filter
      ? filter.split(',').map((p) => p.trim()).filter(Boolean)
      : undefined;
    const report = await checkProvidersStatus({ providers });
    return json(report);
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
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(ping);
        }
      }, 15000);
      try {
        for await (const event of runner.run({ ...parsed, signal: abortController.signal })) {
          controller.enqueue(encoder.encode(sseEvent(event)));
          if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') break;
        }
        controller.close();
      } catch (error) {
        controller.enqueue(encoder.encode(`event: failed\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n\n`));
        controller.close();
      } finally {
        clearInterval(ping);
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

async function handleNodeRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  runner: HeadlessRunner,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  incoming.once('aborted', abort);
  outgoing.once('close', () => {
    if (!outgoing.writableFinished) controller.abort();
  });

  try {
    const body = incoming.method === 'GET' || incoming.method === 'HEAD'
      ? undefined
      : await readBody(incoming, controller.signal);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const host = headers.get('host') ?? `${hostName(incoming)}:${hostPort(incoming)}`;
    const request = new Request(`http://${host}${incoming.url ?? '/'}`, {
      method: incoming.method ?? 'GET',
      headers,
      body: body?.toString('utf8'),
      signal: controller.signal,
    });
    const response = await handleRequest(request, runner);

    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    outgoing.writeHead(response.status);
    if (!response.body) {
      outgoing.end();
      return;
    }

    const reader = response.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (outgoing.destroyed) break;
        outgoing.write(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (!outgoing.writableEnded && !outgoing.destroyed) outgoing.end();
  } catch (error) {
    process.stderr.write(`[dexter-http] 处理请求失败 ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    if (outgoing.headersSent) {
      if (!outgoing.writableEnded && !outgoing.destroyed) outgoing.end();
      return;
    }
    if (controller.signal.aborted || outgoing.destroyed) return;
    outgoing.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    outgoing.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  } finally {
    incoming.off('aborted', abort);
    if (outgoing.headersSent && !outgoing.writableEnded && !outgoing.destroyed) {
      outgoing.end();
    }
  }
}

async function readBody(request: IncomingMessage, signal: AbortSignal): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (signal.aborted) return undefined;
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function hostName(request: IncomingMessage): string {
  return request.socket.localAddress ?? '127.0.0.1';
}

function hostPort(request: IncomingMessage): number {
  return request.socket.localPort ?? 80;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isAuthorized(request: Request): boolean {
  const token = process.env.DEXTER_SERVICE_TOKEN?.trim();
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${token}`;
}
