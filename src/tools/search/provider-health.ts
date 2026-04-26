export type SearchProviderId = 'exa' | 'perplexity' | 'tavily' | 'brave';

type SearchProviderStatus = 'healthy' | 'degraded' | 'auth_failed' | 'rate_limited';
type SearchFailureKind = 'auth' | 'rate_limit' | 'transient' | 'no_data' | 'unknown';

type ProviderMetrics = {
  requests: number;
  successes: number;
  failures: number;
  authFailures: number;
  rateLimitFailures: number;
  noDataResponses: number;
  totalLatencyMs: number;
  latenciesMs: number[];
};

type ProviderHealthRecord = {
  status: SearchProviderStatus;
  consecutiveFailures: number;
  disabledUntil: number | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  metrics: ProviderMetrics;
};

const MAX_LATENCIES = 50;
const TRANSIENT_DISABLE_MS = 30_000;
const RATE_LIMIT_DISABLE_MS = 90_000;
const AUTH_DISABLE_MS = 30 * 60_000;
const FAILURE_THRESHOLD = 2;

const healthByProvider = new Map<SearchProviderId, ProviderHealthRecord>();

function getDefaultMetrics(): ProviderMetrics {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    authFailures: 0,
    rateLimitFailures: 0,
    noDataResponses: 0,
    totalLatencyMs: 0,
    latenciesMs: [],
  };
}

function getRecord(provider: SearchProviderId): ProviderHealthRecord {
  let record = healthByProvider.get(provider);
  if (!record) {
    record = {
      status: 'healthy',
      consecutiveFailures: 0,
      disabledUntil: null,
      lastError: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      metrics: getDefaultMetrics(),
    };
    healthByProvider.set(provider, record);
  }
  return record;
}

function getProviderEnvVar(provider: SearchProviderId): string {
  switch (provider) {
    case 'exa':
      return 'EXASEARCH_API_KEY';
    case 'perplexity':
      return 'PERPLEXITY_API_KEY';
    case 'tavily':
      return 'TAVILY_API_KEY';
    case 'brave':
      return 'BRAVE_SEARCH_API_KEY';
  }
}

function isConfigSane(provider: SearchProviderId, value: string): boolean {
  const trimmed = value.trim();
  switch (provider) {
    case 'exa':
      return trimmed.length >= 16;
    case 'perplexity':
      return trimmed.length >= 16;
    case 'tavily':
      return trimmed.length >= 16;
    case 'brave':
      return trimmed.length >= 16;
  }
}

export function listConfiguredSearchProviders(): SearchProviderId[] {
  const providers: SearchProviderId[] = [];
  for (const provider of ['exa', 'perplexity', 'tavily', 'brave'] as const) {
    const envVar = getProviderEnvVar(provider);
    const value = process.env[envVar];
    if (value && isConfigSane(provider, value)) {
      providers.push(provider);
    }
  }
  return providers;
}

export function hasReadySearchProvider(): boolean {
  return listAvailableSearchProviders().length > 0;
}

export function listAvailableSearchProviders(): SearchProviderId[] {
  const now = Date.now();
  return listConfiguredSearchProviders().filter((provider) => {
    const record = getRecord(provider);
    return !record.disabledUntil || record.disabledUntil <= now;
  });
}

export function classifySearchFailure(message: string): SearchFailureKind {
  const lower = message.toLowerCase();
  if (
    lower.includes('invalid api key') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('api key is not set')
  ) {
    return 'auth';
  }
  if (
    lower.includes('rate limited') ||
    lower.includes('too many requests') ||
    lower.includes('429') ||
    lower.includes('retry-after')
  ) {
    return 'rate_limit';
  }
  if (
    lower.includes('no search results') ||
    lower.includes('no useful data') ||
    lower.includes('returned 0 results')
  ) {
    return 'no_data';
  }
  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('5xx')
  ) {
    return 'transient';
  }
  return 'unknown';
}

export function recordSearchProviderSuccess(
  provider: SearchProviderId,
  params: { durationMs: number; resultCount: number },
): void {
  const record = getRecord(provider);
  record.status = 'healthy';
  record.consecutiveFailures = 0;
  record.disabledUntil = null;
  record.lastError = null;
  record.lastSuccessAt = new Date().toISOString();
  record.metrics.requests += 1;
  record.metrics.successes += 1;
  if (params.resultCount === 0) {
    record.metrics.noDataResponses += 1;
  }
  record.metrics.totalLatencyMs += params.durationMs;
  record.metrics.latenciesMs.push(params.durationMs);
  if (record.metrics.latenciesMs.length > MAX_LATENCIES) {
    record.metrics.latenciesMs.shift();
  }
}

export function recordSearchProviderFailure(
  provider: SearchProviderId,
  params: { error: string; durationMs: number },
): SearchFailureKind {
  const record = getRecord(provider);
  const kind = classifySearchFailure(params.error);
  record.metrics.requests += 1;
  record.metrics.failures += 1;
  record.metrics.totalLatencyMs += params.durationMs;
  record.metrics.latenciesMs.push(params.durationMs);
  if (record.metrics.latenciesMs.length > MAX_LATENCIES) {
    record.metrics.latenciesMs.shift();
  }

  record.consecutiveFailures += 1;
  record.lastError = params.error;
  record.lastFailureAt = new Date().toISOString();

  if (kind === 'auth') {
    record.status = 'auth_failed';
    record.disabledUntil = Date.now() + AUTH_DISABLE_MS;
    record.metrics.authFailures += 1;
    return kind;
  }

  if (kind === 'rate_limit') {
    record.status = 'rate_limited';
    record.disabledUntil = Date.now() + RATE_LIMIT_DISABLE_MS;
    record.metrics.rateLimitFailures += 1;
    return kind;
  }

  if (kind === 'no_data') {
    record.status = 'degraded';
    record.disabledUntil = null;
    record.metrics.noDataResponses += 1;
    return kind;
  }

  if (record.consecutiveFailures >= FAILURE_THRESHOLD) {
    record.status = 'degraded';
    record.disabledUntil = Date.now() + TRANSIENT_DISABLE_MS;
  } else {
    record.status = 'degraded';
    record.disabledUntil = null;
  }

  return kind;
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? null;
}

export function getSearchObservabilitySnapshot() {
  const snapshot = listConfiguredSearchProviders().map((provider) => {
    const record = getRecord(provider);
    return {
      provider,
      status: record.status,
      disabledUntil: record.disabledUntil ? new Date(record.disabledUntil).toISOString() : null,
      consecutiveFailures: record.consecutiveFailures,
      lastError: record.lastError,
      lastSuccessAt: record.lastSuccessAt,
      lastFailureAt: record.lastFailureAt,
      requests: record.metrics.requests,
      successes: record.metrics.successes,
      failures: record.metrics.failures,
      authFailures: record.metrics.authFailures,
      rateLimitFailures: record.metrics.rateLimitFailures,
      noDataResponses: record.metrics.noDataResponses,
      avgLatencyMs:
        record.metrics.requests > 0 ? Math.round(record.metrics.totalLatencyMs / record.metrics.requests) : null,
      p95LatencyMs: p95(record.metrics.latenciesMs),
    };
  });
  return {
    healthyProviders: listAvailableSearchProviders(),
    providers: snapshot,
  };
}
