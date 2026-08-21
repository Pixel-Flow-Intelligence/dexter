import { gunzipSync } from 'zlib';
import { logger } from '../../../utils/logger.js';

export class ProviderHttpError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    message: string,
  ) {
    super(`[${provider}] ${status}: ${message}`);
    this.name = 'ProviderHttpError';
  }
}

function decodeBody(raw: ArrayBuffer, contentEncoding: string | null): string {
  const buf = Buffer.from(raw);
  const enc = (contentEncoding || '').toLowerCase();
  if (enc.includes('gzip') || (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b)) {
    try {
      return gunzipSync(buf).toString('utf-8');
    } catch {
      // fall through
    }
  }
  return buf.toString('utf-8');
}

async function fetchDecoded(
  provider: string,
  url: string,
  init: RequestInit = {},
  defaultAccept = 'application/json',
): Promise<{ text: string; status: number; url: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: defaultAccept,
        'User-Agent': 'DexterFinance/1.0',
        ...init.headers,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[${provider}] network error: ${message}`);
    throw new ProviderHttpError(provider, 0, message);
  }

  const raw = await response.arrayBuffer();
  const text = decodeBody(raw, response.headers.get('content-encoding'));

  if (!response.ok) {
    logger.error(`[${provider}] ${response.status} ${url} — ${text.slice(0, 200)}`);
    throw new ProviderHttpError(provider, response.status, text.slice(0, 300) || response.statusText);
  }

  return { text, status: response.status, url };
}

export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit = {},
): Promise<{ data: unknown; url: string }> {
  const { text, status } = await fetchDecoded(provider, url, init, 'application/json');

  if (!text.trim()) {
    return { data: null, url };
  }

  try {
    return { data: JSON.parse(text) as unknown, url };
  } catch {
    throw new ProviderHttpError(provider, status, `invalid JSON: ${text.slice(0, 120)}`);
  }
}

/** Fetch raw text/HTML (SEC filing documents, etc.). */
export async function providerFetchText(
  provider: string,
  url: string,
  init: RequestInit = {},
): Promise<{ text: string; url: string }> {
  const { text } = await fetchDecoded(provider, url, init, 'text/html,application/xhtml+xml,*/*');
  return { text, url };
}

export async function withFallback<T>(
  label: string,
  attempts: Array<{ name: string; run: () => Promise<T> }>,
): Promise<T> {
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await attempt.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${attempt.name}: ${message}`);
      logger.warn(`[finance-router] ${label} ${attempt.name} failed — ${message}`);
    }
  }
  throw new Error(`[finance-router] ${label} failed: ${errors.join(' | ')}`);
}
