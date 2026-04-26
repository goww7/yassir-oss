import { DynamicStructuredTool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';
import { halalTerminalGet } from '../../integrations/halalterminal/client.js';

/**
 * Rich description for the read_filings tool.
 * Used in the system prompt to guide the LLM on when and how to use this tool.
 */
export const READ_FILINGS_DESCRIPTION = `
Intelligent meta-tool for SEC filing metadata and XBRL company facts through Halal Terminal.

## When to Use

- Listing recent SEC filings for a company
- Checking whether a 10-K, 10-Q, or 8-K exists
- Retrieving SEC XBRL company facts exposed by Halal Terminal
- Getting filing URLs or metadata before deeper analysis

## When NOT to Use

- Current prices or market news (use get_market_data)
- Shariah compliance (use get_shariah)

## Usage Notes

- Call ONCE with the complete natural language query
- Handles ticker resolution (Apple -> AAPL)
- Returns filing metadata and, when useful, XBRL facts with source URLs
- For full filing text analysis, continue from returned SEC links with web_fetch when needed
`.trim();

const FilingTypeSchema = z.enum(['10-K', '10-Q', '8-K']);

const FilingPlanSchema = z.object({
  ticker: z.string().describe('Stock ticker symbol, for example AAPL, TSLA, or MSFT'),
  filing_type: FilingTypeSchema.optional().describe('Optional filing type filter'),
  limit: z.number().int().min(1).max(25).default(10),
  include_facts: z.boolean().default(false).describe('Whether SEC XBRL company facts are needed'),
});

type FilingPlan = z.infer<typeof FilingPlanSchema>;

function buildPlanPrompt(): string {
  return `You are a SEC filings planning assistant using Halal Terminal.
Current date: ${getCurrentDate()}

Given a user query about SEC filings, return structured plan fields:
- ticker
- filing_type, only if the user asks for a specific 10-K, 10-Q, or 8-K
- limit
- include_facts, true when the user asks for XBRL facts, reported financial facts, or structured company facts

Ticker examples: Apple -> AAPL, Tesla -> TSLA, Microsoft -> MSFT, Amazon -> AMZN, Google/Alphabet -> GOOGL.`;
}

async function halalGet(path: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const response = await halalTerminalGet(path, params);
  return { data: response.data, url: response.url };
}

const ReadFilingsInputSchema = z.object({
  query: z.string().describe('Natural language query about SEC filing metadata or XBRL facts'),
});

export function createReadFilings(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'read_filings',
    description: `Retrieve SEC filing metadata and XBRL company facts from Halal Terminal. Use for:
- Recent 10-K, 10-Q, and 8-K filing metadata
- Filing URLs and accession metadata
- Structured SEC XBRL company facts
- Filing discovery before deeper web_fetch analysis`,
    schema: ReadFilingsInputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      onProgress?.('Planning filing lookup...');
      let plan: FilingPlan;
      try {
        const { response } = await callLlm(input.query, {
          model,
          systemPrompt: buildPlanPrompt(),
          outputSchema: FilingPlanSchema,
        });
        plan = FilingPlanSchema.parse(response);
      } catch (error) {
        return formatToolResult(
          {
            error: 'Failed to plan Halal Terminal filing lookup',
            details: error instanceof Error ? error.message : String(error),
          },
          [],
        );
      }

      const ticker = plan.ticker.trim().toUpperCase();
      const sourceUrls: string[] = [];
      const result: Record<string, unknown> = {
        source: 'halalterminal',
        ticker,
      };

      onProgress?.(`Fetching filings for ${ticker}...`);
      try {
        const filings = await halalGet(`/api/filings/${ticker}`, {
          filing_type: plan.filing_type,
          limit: plan.limit ?? 10,
        });
        result.filings = filings.data;
        sourceUrls.push(filings.url);
      } catch (error) {
        result.filingsError = error instanceof Error ? error.message : String(error);
      }

      if (plan.include_facts) {
        onProgress?.(`Fetching XBRL facts for ${ticker}...`);
        try {
          const facts = await halalGet(`/api/filings/${ticker}/facts`);
          result.facts = facts.data;
          sourceUrls.push(facts.url);
        } catch (error) {
          result.factsError = error instanceof Error ? error.message : String(error);
        }
      }

      result.internal_research_plan = [
        'Use returned filing URLs with web_fetch for full filing text or specific item analysis.',
        'Use sec_company_facts for an independent SEC open-data cross-check when numeric facts matter.',
        'Use web_search for issuer investor-relations pages, earnings releases, or transcripts.',
      ];

      return formatToolResult(result, sourceUrls);
    },
  });
}
