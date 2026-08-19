import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { parseRemoteArgs } from './args.js';
import { DEFAULT_HTTP_URL, loadRemoteConfig, saveRemoteConfig } from './config.js';
import { runHttpResearch } from './sse-client.js';
import { serializeRemoteMessage } from './protocol.js';

const remoteArgs = parseRemoteArgs(process.argv.slice(2));

await main().catch((error: unknown) => {
  process.stderr.write(`Dexter remote failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (remoteArgs.configCommand) {
    await handleConfigCommand(remoteArgs.configCommand.action, remoteArgs.configCommand.value);
    return;
  }
  if (remoteArgs.mode === 'http') {
    await runHttpMode(remoteArgs.query);
    return;
  }
  await runSshMode(remoteArgs.query);
}

async function runSshMode(query: string | undefined): Promise<void> {
  const host = process.env.DEXTER_REMOTE_HOST ?? '45.76.149.53';
  const user = process.env.DEXTER_REMOTE_USER ?? 'root';
  const port = process.env.DEXTER_REMOTE_PORT ?? '22';
  const key = expandHome(process.env.DEXTER_REMOTE_KEY ?? '~/.ssh/nofx');
  const remoteDir = process.env.DEXTER_REMOTE_DIR ?? '/root/Project/dexter';
  const remoteBun = process.env.DEXTER_REMOTE_BUN ?? '/root/.bun/bin/bun';
  const remoteBinDir = process.env.DEXTER_REMOTE_BUN_DIR ?? '/root/.bun/bin';
  const target = `${user}@${host}`;
  const remoteCommand = `export PATH=${shellQuote(remoteBinDir)}:$PATH && cd ${shellQuote(remoteDir)} && ${shellQuote(remoteBun)} run remote:bridge`;

  const child = spawn('ssh', [
    '-T', '-i', key, '-p', port,
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'IdentitiesOnly=yes',
    target,
    remoteCommand,
  ], { stdio: ['pipe', 'pipe', 'inherit'] });

  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let printedAnswer = false;
  output.on('line', (line) => {
    try {
      const event = JSON.parse(line) as { type?: string; message?: string; answer?: string; error?: string };
      if (event.type === 'thinking' || event.type === 'progress') process.stderr.write(`[dexter] ${event.message ?? ''}\n`);
      else if (event.type === 'report') {
        process.stdout.write(`${event.answer ?? ''}\n`);
        printedAnswer = true;
      } else if (event.type === 'completed' && !printedAnswer) {
        process.stdout.write(`${event.answer ?? ''}\n`);
      } else if (event.type === 'failed') process.stderr.write(`Dexter failed: ${event.error ?? 'unknown error'}\n`);
    } catch {
      process.stderr.write(`${line}\n`);
    }
  });

  const send = (text: string): void => {
    child.stdin.write(`${serializeRemoteMessage({ type: 'query', query: text, runId: randomUUID(), sessionId: 'remote-cli' })}\n`);
  };

  if (query) {
    send(query);
    child.stdin.end();
  } else {
    const input = createInterface({ input: process.stdin, output: process.stderr, prompt: 'dexter> ' });
    input.prompt();
    input.on('line', (line) => {
      if (line.trim() === '/exit') {
        input.close();
        child.stdin.end();
        return;
      }
      if (line.trim()) send(line);
      input.prompt();
    });
    input.on('close', () => child.stdin.end());
  }

  await new Promise<void>((resolve) => child.on('close', () => resolve()));
}

async function runHttpMode(query: string | undefined): Promise<void> {
  const config = await loadRemoteConfig();
  const url = process.env.DEXTER_REMOTE_HTTP_URL ?? config.httpUrl ?? DEFAULT_HTTP_URL;
  const token = process.env.DEXTER_SERVICE_TOKEN ?? config.serviceToken;
  if (!token) throw new Error('Dexter service token is not configured; run "bun run remote config set-token <token>"');

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  try {
    if (query) {
      await runOneHttpQuery(url, token, query, controller.signal);
      return;
    }
    const input = createInterface({ input: process.stdin, output: process.stderr, prompt: 'dexter> ' });
    input.prompt();
    for await (const line of input) {
      if (line.trim() === '/exit') break;
      if (!line.trim()) {
        input.prompt();
        continue;
      }
      await runOneHttpQuery(url, token, line, controller.signal);
      if (!controller.signal.aborted) input.prompt();
    }
  } finally {
    process.removeListener('SIGINT', stop);
  }
}

async function runOneHttpQuery(url: string, token: string, query: string, signal: AbortSignal): Promise<void> {
  let printedAnswer = false;
  await runHttpResearch({
    url,
    token,
    query,
    signal,
    onEvent: (event) => {
      if (event.type === 'report') {
        process.stdout.write(`${stringValue(event.answer)}\n`);
        printedAnswer = true;
      } else if (event.type === 'completed' && !printedAnswer) {
        process.stdout.write(`${stringValue(event.answer)}\n`);
      } else if (event.type === 'failed') {
        process.stderr.write(`Dexter failed: ${stringValue(event.error) || 'unknown error'}\n`);
      } else if (event.type === 'thinking' || event.type === 'progress' || event.type === 'tool_start' || event.type === 'tool_end') {
        process.stderr.write(`[dexter] ${stringValue(event.message) || stringValue(event.tool)}\n`);
      }
    },
  });
}

async function handleConfigCommand(action: 'set-url' | 'set-token' | 'show' | 'clear-token', value?: string): Promise<void> {
  const config = await loadRemoteConfig();
  if (action === 'show') {
    process.stdout.write(`config path: ${process.env.DEXTER_CONFIG_PATH ?? '~/.config/dexter/config.json'}\n`);
    process.stdout.write(`http URL: ${config.httpUrl ?? DEFAULT_HTTP_URL}\n`);
    process.stdout.write(`service token: ${config.serviceToken ? 'configured' : 'not configured'}\n`);
    return;
  }
  if (action === 'set-url') {
    if (!value) throw new Error('config set-url requires an HTTP URL');
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('config URL must use http or https');
    await saveRemoteConfig({ ...config, httpUrl: value });
    process.stdout.write('Dexter HTTP URL saved.\n');
    return;
  }
  if (action === 'clear-token') {
    await saveRemoteConfig({ ...config, serviceToken: undefined });
    process.stdout.write('Dexter service token cleared.\n');
    return;
  }
  const token = value === '-' ? (await readStdin()).trim() : value ?? process.env.DEXTER_SERVICE_TOKEN?.trim();
  if (!token) throw new Error('config set-token requires a token or stdin value using "-"');
  await saveRemoteConfig({ ...config, serviceToken: token });
  process.stdout.write('Dexter service token saved.\n');
}

async function readStdin(): Promise<string> {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function expandHome(value: string): string {
  return value.startsWith('~/') ? `${homedir()}/${value.slice(2)}` : value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
