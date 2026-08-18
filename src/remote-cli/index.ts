import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { serializeRemoteMessage } from './protocol.js';

const args = process.argv.slice(2);
const queryIndex = args.indexOf('--query');
const query = queryIndex >= 0 ? args[queryIndex + 1] : undefined;
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
    }
    else if (event.type === 'failed') process.stderr.write(`Dexter failed: ${event.error ?? 'unknown error'}\n`);
  } catch {
    process.stderr.write(`${line}\n`);
  }
});

function send(text: string): void {
  child.stdin.write(`${serializeRemoteMessage({ type: 'query', query: text, runId: randomUUID(), sessionId: 'remote-cli' })}\n`);
}

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

child.on('close', (code) => process.exit(code ?? 1));

function expandHome(value: string): string {
  return value.startsWith('~/') ? `${homedir()}/${value.slice(2)}` : value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
