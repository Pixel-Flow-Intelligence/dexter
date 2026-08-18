export interface RemoteQueryMessage {
  type: 'query';
  query: string;
  runId?: string;
  sessionId?: string;
  model?: string;
  modelProvider?: string;
}

export type RemoteMessage = RemoteQueryMessage | object;

export function serializeRemoteMessage(message: object): string {
  return JSON.stringify(message);
}

export function parseRemoteMessage(line: string): RemoteMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error('Invalid remote message: expected JSON');
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { type?: unknown }).type !== 'query') {
    throw new Error('Unsupported remote message: expected query');
  }
  const message = parsed as { type: 'query'; query?: unknown };
  if (typeof message.query !== 'string' || !message.query.trim()) {
    throw new Error('Invalid remote message: query is required');
  }
  return parsed as RemoteQueryMessage;
}
