import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface RemoteConfig {
  httpUrl?: string;
  serviceToken?: string;
}

export const DEFAULT_HTTP_URL = 'https://dexter.moltbot.dpdns.org';

export function defaultRemoteConfigPath(): string {
  return process.env.DEXTER_CONFIG_PATH ?? join(homedir(), '.config', 'dexter', 'config.json');
}

export async function loadRemoteConfig(filePath = defaultRemoteConfigPath()): Promise<RemoteConfig> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    if (!value || typeof value !== 'object') return {};
    const record = value as Record<string, unknown>;
    return {
      httpUrl: typeof record.httpUrl === 'string' ? record.httpUrl : undefined,
      serviceToken: typeof record.serviceToken === 'string' ? record.serviceToken : undefined,
    };
  } catch (error) {
    if (isFileMissing(error)) return {};
    throw error;
  }
}

export async function saveRemoteConfig(config: RemoteConfig, filePath = defaultRemoteConfigPath()): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

function isFileMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
