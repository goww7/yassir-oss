import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { formatSearchProviderError } from './error-format.js';
import { logger } from '../../utils/logger.js';

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_BRAVE_RESULTS = 10;

type BraveResult = {
  title?: string;
  url?: string;
  description?: string;
  extra_snippets?: string[];
};

type BraveResponse = {
  web?: {
    results?: BraveResult[];
  };
};

async function callBrave(query: string): Promise<BraveResponse> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error('[Brave API] BRAVE_SEARCH_API_KEY is not set');
  }

  const url = new URL(BRAVE_API_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(DEFAULT_BRAVE_RESULTS));
  url.searchParams.set('extra_snippets', 'true');

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`[Brave API] ${response.status}: ${text}`);
  }

  return response.json() as Promise<BraveResponse>;
}

export const braveSearch = new DynamicStructuredTool({
  name: 'web_search',
  description:
    'Search the web using Brave Search. Returns web results with titles, URLs, and snippets.',
  schema: z.object({
    query: z.string().describe('The search query to look up on the web'),
  }),
  func: async (input) => {
    try {
      const result = await callBrave(input.query);
      const results = (result.web?.results ?? []).map((item) => ({
        title: item.title,
        url: item.url,
        snippet: [item.description, ...(item.extra_snippets ?? [])].filter(Boolean).join(' '),
      }));
      const urls = results.map((item) => item.url).filter((url): url is string => Boolean(url));
      return formatToolResult({ results }, urls);
    } catch (error) {
      const message = formatSearchProviderError('Brave API', error);
      logger.error(`[Brave API] error: ${message}`);
      throw new Error(message);
    }
  },
});
