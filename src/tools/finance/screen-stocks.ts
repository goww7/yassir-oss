import { DynamicStructuredTool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';
import { halalTerminalGet } from '../../integrations/halalterminal/client.js';

export const SCREEN_STOCKS_DESCRIPTION = `
Search the Halal Terminal asset database for equities, ETFs, or funds and produce a practical candidate set for follow-up research.

## When to Use

- Finding assets by company name, ticker, sector, country, exchange, or asset type
- Looking for halal-aware candidate universes before Shariah screening
- Searching ETFs, funds, or equities available in the Halal Terminal database

## Usage Notes

- Call ONCE with the complete natural language query
- If the query includes numeric metric criteria, this tool first discovers plausible candidates, then the agent should enrich candidates with get_financials, get_shariah, read_filings, or web_search as needed
`.trim();

const SearchPlanSchema = z.object({
  q: z.string().optional().describe('Search text such as ticker, company name, or theme'),
  asset_type: z.enum(['equities', 'etfs', 'funds']).default('equities'),
  sector: z.string().optional(),
  country: z.string().optional(),
  exchange: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
  numeric_filters_requested: z.boolean().default(false),
});

type SearchPlan = z.infer<typeof SearchPlanSchema>;

function buildSearchPrompt(): string {
  return `You are a Halal Terminal database search planner.
Current date: ${getCurrentDate()}

Turn the user's stock screening/search request into Halal Terminal database search parameters:
- q: ticker, company name, or concise theme if present
- asset_type: equities, etfs, or funds
- sector, country, exchange when explicitly requested
- limit, default 20
- numeric_filters_requested: true if the user asks for numeric metrics like P/E, ROE, revenue growth, margins, dividend yield, debt, or valuation thresholds

For numeric metric requests, build the best broad discovery search and set numeric_filters_requested=true. The outer agent will enrich and rank candidates using follow-up tools.`;
}

async function halalGet(path: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const response = await halalTerminalGet(path, params);
  return { data: response.data, url: response.url };
}

const ScreenStocksInputSchema = z.object({
  query: z.string().describe('Natural language query describing asset search criteria'),
});

export function createScreenStocks(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'stock_screener',
    description: `Search the Halal Terminal database for equities, ETFs, or funds. Use for:
- Asset search by ticker/company/theme
- Filters by sector, country, exchange, or asset type
- Candidate discovery before Shariah screening or deeper financial analysis`,
    schema: ScreenStocksInputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      onProgress?.('Planning Halal Terminal database search...');
      let plan: SearchPlan;
      try {
        const { response } = await callLlm(input.query, {
          model,
          systemPrompt: buildSearchPrompt(),
          outputSchema: SearchPlanSchema,
        });
        plan = SearchPlanSchema.parse(response);
      } catch (error) {
        return formatToolResult(
          {
            error: 'Failed to parse Halal Terminal search criteria',
            details: error instanceof Error ? error.message : String(error),
          },
          [],
        );
      }

      onProgress?.('Searching Halal Terminal database...');
      try {
        const { data, url } = await halalGet('/api/database/search', {
          q: plan.q,
          asset_type: plan.asset_type,
          sector: plan.sector,
          country: plan.country,
          exchange: plan.exchange,
          limit: plan.limit ?? 20,
          offset: 0,
        });

        return formatToolResult(
          {
            source: 'halalterminal',
            query: input.query,
            plan,
            results: data,
            internal_research_plan: plan.numeric_filters_requested
              ? [
                  'Treat these as first-pass candidates.',
                  'Call get_financials for per-symbol profile, quote, dividends, and SEC facts.',
                  'Call get_shariah for compliance, ratios, purification, and methodology context.',
                  'Use web_search or read_filings for current or issuer-specific numeric evidence.',
                ]
              : [
                  'Call get_shariah for compliance verification when the user asks for halal candidates.',
                  'Call get_market_data or get_financials to enrich selected symbols.',
                ],
          },
          [url],
        );
      } catch (error) {
        return formatToolResult(
          {
            error: 'Halal Terminal database search failed',
            details: error instanceof Error ? error.message : String(error),
            plan,
          },
          [],
        );
      }
    },
  });
}
