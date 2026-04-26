function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength = 180): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

export function formatSearchProviderError(providerLabel: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = normalizeWhitespace(raw);
  const lower = message.toLowerCase();

  if (lower.includes('invalid api key')) {
    return `[${providerLabel}] Invalid API key`;
  }

  if (lower.includes('unauthorized') || lower.includes('status: 401') || lower.includes(' 401')) {
    return `[${providerLabel}] Unauthorized - check API key`;
  }

  if (lower.includes('forbidden') || lower.includes('status: 403') || lower.includes(' 403')) {
    return `[${providerLabel}] Forbidden - check API key or account permissions`;
  }

  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('status: 429')) {
    return `[${providerLabel}] Rate limited`;
  }

  if (lower.includes('response (') || lower.includes('headers: headers')) {
    return `[${providerLabel}] Request failed`;
  }

  return truncate(message);
}
