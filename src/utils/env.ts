import { existsSync, readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import { getProviderById } from '../providers.js';

/** Keys Dexter must take from its own `.env`, never from Admin/nofx inheritance. */
const DEXTER_OWNED_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
  'MOONSHOT_API_KEY',
  'DEEPSEEK_API_KEY',
  'OLLAMA_BASE_URL',
  'OLLAMA_CLOUD_API_KEY',
  'FINANCIAL_DATASETS_API_KEY',
  'EXASEARCH_API_KEY',
  'PERPLEXITY_API_KEY',
  'TAVILY_API_KEY',
  'LANGSEARCH_API_KEY',
  'X_BEARER_TOKEN',
  'LANGSMITH_API_KEY',
  'LANGSMITH_ENDPOINT',
  'LANGSMITH_PROJECT',
  'LANGSMITH_TRACING',
  'LANGCHAIN_PROJECT',
] as const;

const DEXTER_OWNED_ENV_KEY_SET = new Set<string>(DEXTER_OWNED_ENV_KEYS);

function parseDotEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

/**
 * Force Dexter-owned LLM/data keys from cwd `.env` over inherited Admin env.
 * Leaves DEXTER_SERVICE_TOKEN / DEXTER_HTTP_* for nofx to inject.
 */
export function applyDexterOwnedEnv(envFile = '.env'): void {
  if (!existsSync(envFile)) {
    return;
  }
  const parsed = parseDotEnvFile(readFileSync(envFile, 'utf-8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (!DEXTER_OWNED_ENV_KEY_SET.has(key)) {
      continue;
    }
    process.env[key] = value;
  }
}

// Load .env on module import, then take back Dexter-owned keys from the file.
config({ quiet: true });
applyDexterOwnedEnv();

export function getApiKeyNameForProvider(providerId: string): string | undefined {
  return getProviderById(providerId)?.apiKeyEnvVar;
}

export function getProviderDisplayName(providerId: string): string {
  return getProviderById(providerId)?.displayName ?? providerId;
}

export function checkApiKeyExistsForProvider(providerId: string): boolean {
  const apiKeyName = getApiKeyNameForProvider(providerId);
  if (!apiKeyName) return true;
  return checkApiKeyExists(apiKeyName);
}

export function checkApiKeyExists(apiKeyName: string): boolean {
  const value = process.env[apiKeyName];
  if (value && value.trim() && !value.trim().startsWith('your-')) {
    return true;
  }

  // Also check .env file directly
  if (existsSync('.env')) {
    const envContent = readFileSync('.env', 'utf-8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key.trim() === apiKeyName) {
          const val = valueParts.join('=').trim();
          if (val && !val.startsWith('your-')) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

export function saveApiKeyToEnv(apiKeyName: string, apiKeyValue: string): boolean {
  try {
    let lines: string[] = [];
    let keyUpdated = false;

    if (existsSync('.env')) {
      const existingContent = readFileSync('.env', 'utf-8');
      const existingLines = existingContent.split('\n');

      for (const line of existingLines) {
        const stripped = line.trim();
        if (!stripped || stripped.startsWith('#')) {
          lines.push(line);
        } else if (stripped.includes('=')) {
          const key = stripped.split('=')[0].trim();
          if (key === apiKeyName) {
            lines.push(`${apiKeyName}=${apiKeyValue}`);
            keyUpdated = true;
          } else {
            lines.push(line);
          }
        } else {
          lines.push(line);
        }
      }

      if (!keyUpdated) {
        if (lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) {
          lines.push('');
        }
        lines.push(`${apiKeyName}=${apiKeyValue}`);
      }
    } else {
      lines.push('# LLM API Keys');
      lines.push(`${apiKeyName}=${apiKeyValue}`);
    }

    writeFileSync('.env', lines.join('\n'));

    // Reload environment variables
    config({ override: true, quiet: true });

    return true;
  } catch {
    return false;
  }
}

export function saveApiKeyForProvider(providerId: string, apiKey: string): boolean {
  const apiKeyName = getApiKeyNameForProvider(providerId);
  if (!apiKeyName) return false;
  return saveApiKeyToEnv(apiKeyName, apiKey);
}

export type SearchProviderId = 'exa' | 'perplexity' | 'tavily' | 'langsearch';

export const SEARCH_PROVIDERS: Record<SearchProviderId, { displayName: string; apiKeyEnvVar: string }> = {
  exa: { displayName: 'Exa', apiKeyEnvVar: 'EXASEARCH_API_KEY' },
  perplexity: { displayName: 'Perplexity', apiKeyEnvVar: 'PERPLEXITY_API_KEY' },
  tavily: { displayName: 'Tavily', apiKeyEnvVar: 'TAVILY_API_KEY' },
  langsearch: { displayName: 'LangSearch', apiKeyEnvVar: 'LANGSEARCH_API_KEY' },
};

export function getSearchProviderDisplayName(providerId: SearchProviderId): string {
  return SEARCH_PROVIDERS[providerId].displayName;
}

export function getApiKeyNameForSearchProvider(providerId: SearchProviderId): string {
  return SEARCH_PROVIDERS[providerId].apiKeyEnvVar;
}

export function checkApiKeyForSearchProvider(providerId: SearchProviderId): boolean {
  return checkApiKeyExists(SEARCH_PROVIDERS[providerId].apiKeyEnvVar);
}

export function saveApiKeyForSearchProvider(providerId: SearchProviderId, apiKey: string): boolean {
  return saveApiKeyToEnv(SEARCH_PROVIDERS[providerId].apiKeyEnvVar, apiKey);
}
