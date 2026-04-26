import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { formatSearchProviderError } from './error-format.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_TAVILY_RESULTS = 10;

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
};

type TavilyResponse = {
  results?: TavilyResult[];
  answer?: string;
};

async function callTavily(query: string): Promise<TavilyResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('[Tavily API] TAVILY_API_KEY is not set');
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      max_results: DEFAULT_TAVILY_RESULTS,
      search_depth: 'advanced',
      topic: 'general',
      include_answer: true,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { detail?: { error?: string } | string };
      detail =
        typeof body.detail === 'string'
          ? body.detail
          : typeof body.detail?.error === 'string'
            ? body.detail.error
            : '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    throw new Error(`[Tavily API] ${response.status}: ${detail || response.statusText}`);
  }

  return response.json() as Promise<TavilyResponse>;
}

export const tavilySearch = new DynamicStructuredTool({
  name: 'web_search',
  description:
    'Search the web for current information on any topic. Returns relevant search results with URLs and content snippets.',
  schema: z.object({
    query: z.string().describe('The search query to look up on the web'),
  }),
  func: async (input) => {
    try {
      const result = await callTavily(input.query);
      const urls = (result.results ?? [])
        .map((item) => item.url)
        .filter((url): url is string => Boolean(url));
      const parsed = {
        answer: result.answer,
        results: (result.results ?? []).map((item) => ({
          title: item.title,
          url: item.url,
          snippet: item.content ?? item.raw_content,
        })),
      };
      return formatToolResult(parsed, urls);
    } catch (error) {
      const message = formatSearchProviderError('Tavily API', error);
      logger.error(`[Tavily API] error: ${message}`);
      throw new Error(message);
    }
  },
});
