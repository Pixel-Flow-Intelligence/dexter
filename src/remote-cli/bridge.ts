import { createInterface } from 'node:readline';
import { config } from 'dotenv';
import { HeadlessRunner } from '../headless/runner.js';
import type { RemoteQueryMessage } from './protocol.js';
import { parseRemoteMessage, serializeRemoteMessage } from './protocol.js';

config({ quiet: true });
const runner = new HeadlessRunner();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const message = parseRemoteMessage(line) as RemoteQueryMessage;
    const runId = message.runId ?? crypto.randomUUID();
    const sessionId = message.sessionId ?? 'remote-cli';
    for await (const event of runner.run({
      runId,
      sessionId,
      query: message.query,
      model: message.model ?? process.env.DEXTER_MODEL ?? 'gpt-5.6-sol',
      modelProvider: message.modelProvider ?? process.env.DEXTER_MODEL_PROVIDER ?? 'openai',
      memoryEnabled: true,
    })) {
      process.stdout.write(`${serializeRemoteMessage(event)}\n`);
    }
  } catch (error) {
    process.stdout.write(`${serializeRemoteMessage({ type: 'failed', error: error instanceof Error ? error.message : String(error) })}\n`);
  }
}
