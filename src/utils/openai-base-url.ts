/**
 * OpenAI-compatible gateways expose the API under `/v1`; normalize the
 * configured root so the SDK does not accidentally request the web frontend.
 */
export function getOpenAICompatibleBaseUrl(): string | undefined {
  const rawBaseUrl = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, '');
  if (!rawBaseUrl) return undefined;
  return /\/v\d+(?:\/|$)/i.test(rawBaseUrl) ? rawBaseUrl : `${rawBaseUrl}/v1`;
}
