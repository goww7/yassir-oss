import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { braveSearch } from './brave.js';
import { exaSearch } from './exa.js';
import { perplexitySearch } from './perplexity.js';
import { tavilySearch } from './tavily.js';
import { getCurrentProfile } from '../../profile/current.js';
import { formatToolResult } from '../types.js';
import { extractReadableContent, markdownToText, truncateText } from '../fetch/web-fetch-utils.js';
import {
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
  type CacheEntry,
} from '../fetch/cache.js';
import {
  type SearchProviderId,
  getSearchObservabilitySnapshot,
  listAvailableSearchProviders,
  recordSearchProviderFailure,
  recordSearchProviderSuccess,
} from './provider-health.js';
import { logger } from '../../utils/logger.js';

type SearchItem = {
  title?: string;
  url: string;
  snippet?: string;
  provider: SearchProviderId;
  domain: string;
  providerRank: number;
  subquery: string;
  subqueryRank: number;
};

const MAX_RESULTS = 12;
const FETCH_SNIPPET_CHARS = 1200;
const EXPANSION_CACHE = new Map<string, CacheEntry<string | null>>();

type SearchQueryType = 'official-source' | 'general-discovery' | 'news-current' | 'benchmarking';

type SearchBudget = {
  maxSubqueries: number;
  maxProvidersPerSubquery: number;
  maxFetchExpansions: number;
  stopAfterResults: number;
  providerPreference: SearchProviderId[];
};

const SEARCH_BUDGETS: Record<SearchQueryType, SearchBudget> = {
  'official-source': {
    maxSubqueries: 3,
    maxProvidersPerSubquery: 2,
    maxFetchExpansions: 3,
    stopAfterResults: 6,
    providerPreference: ['brave', 'exa', 'perplexity', 'tavily'],
  },
  benchmarking: {
    maxSubqueries: 3,
    maxProvidersPerSubquery: 2,
    maxFetchExpansions: 2,
    stopAfterResults: 8,
    providerPreference: ['brave', 'exa', 'perplexity', 'tavily'],
  },
  'news-current': {
    maxSubqueries: 2,
    maxProvidersPerSubquery: 3,
    maxFetchExpansions: 2,
    stopAfterResults: 8,
    providerPreference: ['perplexity', 'brave', 'tavily', 'exa'],
  },
  'general-discovery': {
    maxSubqueries: 3,
    maxProvidersPerSubquery: 2,
    maxFetchExpansions: 3,
    stopAfterResults: 8,
    providerPreference: ['brave', 'exa', 'perplexity', 'tavily'],
  },
};

function classifyQueryType(query: string): SearchQueryType {
  const lower = query.toLowerCase();
  if (
    /(annual report|investor relations|official site|official source|filing|form 10|pillar 3|earnings release|factsheet|aum|assets under management|cost income|headcount|employees)/.test(
      lower,
    )
  ) {
    return 'official-source';
  }
  if (
    /(benchmark|peer|competitor|competitive|compare|versus|vs\.?|scorecard|ranking|industry grade|kpi|strategic brief)/.test(
      lower,
    )
  ) {
    return 'benchmarking';
  }
  if (/(latest|recent|news|today|this week|current|breaking|update)/.test(lower)) {
    return 'news-current';
  }
  return 'general-discovery';
}

function getBudget(queryType: SearchQueryType): SearchBudget {
  return SEARCH_BUDGETS[queryType];
}

function getProvidersForQuery(queryType: SearchQueryType): SearchProviderId[] {
  const available = new Set(listAvailableSearchProviders());
  const preferred = getBudget(queryType).providerPreference.filter((provider) => available.has(provider));
  return preferred;
}

function getProviderWeight(provider: SearchProviderId): number {
  const weights = getCurrentProfile().vertical.features.searchRanking?.providerWeights;
  return weights?.[provider] ?? 1;
}

function getPrimaryDomains(): string[] {
  return getCurrentProfile().vertical.features.searchRanking?.primaryDomains ?? [];
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function parseToolJson(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  return (raw as Record<string, unknown>) ?? {};
}

function getPreferredDomainRank(domain: string): number {
  const preferredDomains = getCurrentProfile().vertical.features.searchRanking?.preferredDomains ?? [];
  const index = preferredDomains.findIndex(
    (preferred) => domain === preferred || domain.endsWith(`.${preferred}`),
  );
  return index === -1 ? -1 : preferredDomains.length - index;
}

function isDomainMatch(domain: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`));
}

function isPrimaryDomain(domain: string): boolean {
  return isDomainMatch(domain, getPrimaryDomains());
}

function getIntentMatches(query: string) {
  const lower = query.toLowerCase();
  const boosts = getCurrentProfile().vertical.features.searchRanking?.intentBoosts ?? [];
  return boosts.filter((boost) => boost.keywords.some((keyword) => lower.includes(keyword.toLowerCase())));
}

function decomposeQuery(query: string, queryType: SearchQueryType, maxSubqueries: number): string[] {
  const normalized = query.trim().replace(/\s+/g, ' ');
  const variants = new Set<string>([normalized]);
  const primaryDomains = getPrimaryDomains();
  if (primaryDomains[0] && queryType !== 'news-current') {
    variants.add(`${normalized} site:${primaryDomains[0]}`);
  }

  const intentMatches = getIntentMatches(normalized);
  for (const match of intentMatches.slice(0, 2)) {
    if (match.domains?.[0]) {
      variants.add(`${normalized} site:${match.domains[0]}`);
    }
  }

  if (queryType === 'official-source') {
    variants.add(`${normalized} annual report official source`);
    variants.add(`${normalized} investor relations official site`);
  } else if (queryType === 'benchmarking') {
    variants.add(`${normalized} annual report pdf official source`);
    variants.add(`${normalized} peer comparison official source`);
  } else if (queryType === 'news-current') {
    variants.add(`${normalized} latest official source`);
  } else {
    variants.add(`${normalized} official source`);
  }

  return [...variants].slice(0, maxSubqueries);
}

function scoreItem(item: SearchItem): number {
  const preferredRank = getPreferredDomainRank(item.domain);
  const providerWeight = getProviderWeight(item.provider);
  const primarySourceBoost = isPrimaryDomain(item.domain) ? 25 : 0;
  const subqueryBoost = item.subqueryRank * 0.75;
  const hasSnippetBonus = item.snippet ? 0.15 : 0;
  const intentBoost = getIntentMatches(item.subquery).reduce((sum, match) => {
    const domainBoost = match.domains && isDomainMatch(item.domain, match.domains) ? match.boost ?? 8 : 0;
    const providerBoost = match.providers?.[item.provider] ?? 0;
    return sum + domainBoost + providerBoost;
  }, 0);
  return item.providerRank * providerWeight + preferredRank * 10 + primarySourceBoost + subqueryBoost + hasSnippetBonus + intentBoost;
}

function extractItems(
  provider: SearchProviderId,
  payload: Record<string, unknown>,
  subquery: string,
  subqueryRank: number,
): SearchItem[] {
  const data = payload.data as Record<string, unknown> | undefined;
  if (!data) return [];

  const results = Array.isArray(data.results) ? data.results : Array.isArray(data.data) ? data.data : [];
  const extracted: SearchItem[] = [];
  for (const [index, entry] of results.entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url : null;
    if (!url) continue;
    extracted.push({
      title: typeof item.title === 'string' ? item.title : undefined,
      url,
      snippet:
        typeof item.snippet === 'string'
          ? item.snippet
          : typeof item.text === 'string'
            ? item.text
            : typeof item.content === 'string'
              ? item.content
              : undefined,
      provider,
      domain: hostnameFromUrl(url),
      providerRank: Math.max(1, results.length - index),
      subquery,
      subqueryRank,
    });
  }
  return extracted;
}

function diversifyResults(items: SearchItem[], maxResults: number): SearchItem[] {
  const ranked = [...items].sort((a, b) => {
    const primaryDiff = Number(isPrimaryDomain(b.domain)) - Number(isPrimaryDomain(a.domain));
    if (primaryDiff !== 0) return primaryDiff;
    return scoreItem(b) - scoreItem(a);
  });
  const byDomain = new Set<string>();
  const uniqueByUrl = new Set<string>();
  const primaryPass: SearchItem[] = [];
  const overflow: SearchItem[] = [];

  for (const item of ranked) {
    if (uniqueByUrl.has(item.url)) continue;
    uniqueByUrl.add(item.url);
    if (!byDomain.has(item.domain)) {
      byDomain.add(item.domain);
      primaryPass.push(item);
    } else {
      overflow.push(item);
    }
  }

  return [...primaryPass, ...overflow].slice(0, maxResults);
}

async function fetchExpandedSnippet(url: string): Promise<string | null> {
  try {
    const cacheKey = normalizeCacheKey(`search-snippet:${url}`);
    const cached = readCache(EXPANSION_CACHE, cacheKey);
    if (cached) {
      return cached.value;
    }

    const signal = withTimeout(undefined, resolveTimeoutSeconds(undefined, DEFAULT_TIMEOUT_SECONDS) * 1000);
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: '*/*',
      },
      signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('text/') && !contentType.includes('html') && !contentType.includes('json')) {
      return null;
    }
    const text = await readResponseText(response);
    const extracted = await extractReadableContent({ html: text, url, extractMode: 'text' });
    const raw = extracted?.text ? extracted.text : contentType.includes('html') ? markdownToText(text) : text;
    const cleaned = truncateText(raw.trim(), FETCH_SNIPPET_CHARS).text;
    const value = cleaned || null;
    writeCache(
      EXPANSION_CACHE,
      cacheKey,
      value,
      resolveCacheTtlMs(undefined, DEFAULT_CACHE_TTL_MINUTES),
    );
    return value;
  } catch {
    return null;
  }
}

async function runProvider(
  provider: SearchProviderId,
  query: string,
  subqueryRank: number,
): Promise<SearchItem[]> {
  const tool =
    provider === 'exa'
      ? exaSearch
      : provider === 'perplexity'
        ? perplexitySearch
        : provider === 'tavily'
          ? tavilySearch
          : braveSearch;
  const result = await tool.invoke({ query });
  return extractItems(provider, parseToolJson(result), query, subqueryRank);
}

export const federatedWebSearch = new DynamicStructuredTool({
  name: 'web_search',
  description:
    'Search the web with multiple providers, diversify domains, and expand top pages for richer source coverage.',
  schema: z.object({
    query: z.string().describe('The search query to look up on the web'),
  }),
  func: async (input) => {
    const queryType = classifyQueryType(input.query);
    const budget = getBudget(queryType);
    const subqueries = decomposeQuery(input.query, queryType, budget.maxSubqueries);
    const configuredProviders = getProvidersForQuery(queryType);
    if (configuredProviders.length === 0) {
      throw new Error('[Web Search] No healthy search providers configured');
    }

    const providerErrors: string[] = [];
    const gathered: SearchItem[] = [];
    const disabledThisRun = new Set<SearchProviderId>();

    for (const [subqueryIndex, subquery] of subqueries.entries()) {
      const providersForSubquery = configuredProviders
        .filter((provider) => !disabledThisRun.has(provider))
        .slice(0, budget.maxProvidersPerSubquery);
      for (const provider of providersForSubquery) {
        const providerStart = Date.now();
        try {
          const items = await runProvider(provider, subquery, Math.max(1, subqueries.length - subqueryIndex));
          if (items.length === 0) {
            const message = `${provider} (${subquery}): no search results`;
            providerErrors.push(message);
            recordSearchProviderFailure(provider, {
              error: 'No search results found',
              durationMs: Date.now() - providerStart,
            });
          } else {
            gathered.push(...items);
            recordSearchProviderSuccess(provider, {
              durationMs: Date.now() - providerStart,
              resultCount: items.length,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          providerErrors.push(`${provider} (${subquery}): ${message}`);
          const failureKind = recordSearchProviderFailure(provider, {
            error: message,
            durationMs: Date.now() - providerStart,
          });
          if (failureKind === 'auth' || failureKind === 'rate_limit') {
            disabledThisRun.add(provider);
          }
        }
      }
      if (gathered.length >= budget.stopAfterResults) {
        break;
      }
    }

    if (!gathered.length) {
      throw new Error(
        `[Web Search] All providers failed. ${providerErrors.slice(0, 4).join(' | ')}`,
      );
    }

    const diversified = diversifyResults(gathered, MAX_RESULTS);
    const expandedPages = await Promise.all(
      diversified.slice(0, budget.maxFetchExpansions).map(async (item) => ({
        url: item.url,
        title: item.title,
        provider: item.provider,
        domain: item.domain,
        fetchedSnippet: await fetchExpandedSnippet(item.url),
      })),
    );

    const observability = getSearchObservabilitySnapshot();
    const degraded =
      providerErrors.length > 0 || observability.healthyProviders.length < configuredProviders.length;
    if (degraded) {
      logger.warn('[Web Search] degraded mode', {
        queryType,
        providersUsed: configuredProviders,
        healthyProviders: observability.healthyProviders,
        providerErrors: providerErrors.slice(0, 4),
      });
    }

    const results = diversified.map((item) => {
      const expanded = expandedPages.find((page) => page.url === item.url);
      return {
        title: item.title,
        url: item.url,
        domain: item.domain,
        provider: item.provider,
        primarySource: isPrimaryDomain(item.domain),
        subquery: item.subquery,
        score: Number(scoreItem(item).toFixed(2)),
        snippet: expanded?.fetchedSnippet || item.snippet,
      };
    });

    return formatToolResult(
      {
        query: input.query,
        queryType,
        subqueries,
        providersUsed: configuredProviders,
        providerErrors: providerErrors.slice(0, 4),
        degradedMode: degraded,
        searchBudget: {
          maxSubqueries: budget.maxSubqueries,
          maxProvidersPerSubquery: budget.maxProvidersPerSubquery,
          maxFetchExpansions: budget.maxFetchExpansions,
          stopAfterResults: budget.stopAfterResults,
        },
        observability,
        resultCount: results.length,
        results,
      },
      results.map((item) => item.url),
    );
  },
});
