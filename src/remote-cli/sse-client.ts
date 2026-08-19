export interface SseEvent {
  type: string;
  [key: string]: unknown;
}

export interface HttpResearchOptions {
  url: string;
  token: string;
  query: string;
  signal?: AbortSignal;
  onEvent: (event: SseEvent) => void;
}

export function parseSseEvents(input: string): SseEvent[] {
  if (!input.endsWith('\n\n')) return [];
  return input
    .split(/\n\n/)
    .filter((frame) => frame.includes('\ndata:'))
    .flatMap((frame) => {
      const event = frame.match(/(?:^|\n)event:\s*([^\n]+)/)?.[1]?.trim();
      const data = frame.match(/(?:^|\n)data:\s*([^\n]+)/)?.[1]?.trim();
      if (!event || !data) return [];
      try {
        const parsed: unknown = JSON.parse(data);
        return [{ type: event, ...(parsed && typeof parsed === 'object' ? parsed : { data: parsed }) }];
      } catch {
        return [];
      }
    });
}

export async function runHttpResearch(options: HttpResearchOptions): Promise<void> {
  const response = await fetch(`${options.url.replace(/\/$/, '')}/v1/research`, {
    method: 'POST',
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: options.query }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dexter HTTP request failed (${response.status}): ${body || response.statusText}`);
  }
  if (!response.body) throw new Error('Dexter HTTP response has no SSE body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const separator = buffer.lastIndexOf('\n\n');
    if (separator >= 0) {
      for (const event of parseSseEvents(buffer.slice(0, separator + 2))) options.onEvent(event);
      buffer = buffer.slice(separator + 2);
    }
    if (done) break;
  }
  if (buffer.trim()) for (const event of parseSseEvents(`${buffer}\n\n`)) options.onEvent(event);
}
