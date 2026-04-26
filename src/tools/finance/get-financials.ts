import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';

/**
 * Rich description for the get_financials tool.
 * Used in the system prompt to guide the LLM on when and how to use this tool.
 */
export const GET_FINANCIALS_DESCRIPTION = `
Intelligent meta-tool for retrieving company financial context from Halal Terminal. Takes a natural language query and automatically routes to Halal Terminal asset, quote, database, dividend, and SEC facts endpoints.

## When to Use

- Company facts and reference data (sector, industry, exchange, country, company profile)
- Full asset context combining quote, screening, and database data
- Current quote fields such as price, market cap, volume, and 52-week range
- Dividend history
- SEC XBRL company facts exposed by Halal Terminal
- Multi-company comparisons (pass the full query, it handles routing internally)

## When NOT to Use

- Historical price charts or trending movers (use get_market_data instead)
- Company news or insider trading activity (use get_market_data instead)
- General web searches or non-financial topics (use web_search instead)
- Questions that don't require external financial data (answer directly from knowledge)
- Non-public company information
- Real-time trading or order execution
- Reading SEC filing content (use read_filings instead)

## Usage Notes

- Call ONCE with the complete natural language query - the tool handles complexity internally
- For comparisons like "compare AAPL vs MSFT profiles", pass the full query as-is
- Handles ticker resolution automatically (Apple -> AAPL, Microsoft -> MSFT)
- Returns structured JSON data with source URLs for verification
`.trim();

/** Format snake_case tool name to Title Case for progress messages */
function formatSubToolName(name: string): string {
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Import Halal Terminal-backed tools directly (avoid circular deps with index.ts)
import { getStockQuote } from './halal-market.js';
import {
  getAssetFull,
  getDatabaseStock,
  getDividendHistory,
  getHalalFilingFacts,
} from './shariah.js';

// All finance tools available for routing
const FINANCE_TOOLS: StructuredToolInterface[] = [
  getAssetFull,
  getDatabaseStock,
  getStockQuote,
  getDividendHistory,
  getHalalFilingFacts,
];

// Create a map for quick tool lookup by name
const FINANCE_TOOL_MAP = new Map(FINANCE_TOOLS.map(t => [t.name, t]));

// Build the router system prompt - simplified since LLM sees tool schemas
function buildRouterPrompt(): string {
  return `You are a Halal Terminal financial data routing assistant.
Current date: ${getCurrentDate()}

Given a user's natural language query about financial data, call the appropriate Halal Terminal tool(s).

## Guidelines

1. **Ticker Resolution**: Convert company names to ticker symbols:
   - Apple -> AAPL, Tesla -> TSLA, Microsoft -> MSFT, Amazon -> AMZN
   - Google/Alphabet -> GOOGL, Meta/Facebook -> META, Nvidia -> NVDA

2. **Scope**: Prefer Halal Terminal-backed tools. Do not invent exact values outside tool data.

3. **Tool Selection**:
   - For broad company/asset context -> get_asset_full
   - For reference database profile fields -> get_database_stock
   - For current quote, market cap, volume, or price -> get_stock_quote
   - For dividends -> get_dividend_history
   - For SEC XBRL financial facts -> get_halal_filing_facts
   - If no Halal Terminal endpoint fits exactly, return no tool calls. A fallback synthesis pass will keep the user experience seamless.

4. **Efficiency**:
   - Prefer specific tools over general ones when possible
   - For comparisons between companies, call the same tool for each ticker

5. **Constraint Fidelity (critical)**:
   - Treat user constraints as hard requirements (e.g., "exclude tech", "non-technology", sector/country filters).
   - Never call tools for tickers that violate explicit exclusions in the query.
   - Do not invent "default" tickers when the query does not specify companies.
   - Do not reuse example tickers from this prompt unless they are actually requested by the user.
   - If no valid ticker candidates are present after applying constraints, return no tool calls.

Call the appropriate tool(s) now.`;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : String(content);
}

function buildFallbackPrompt(): string {
  return `You are a financial research assistant inside Yassir.
Current date: ${getCurrentDate()}

The dedicated Halal Terminal finance router did not find a precise structured endpoint for the user's request. Provide a concise best-effort research brief from general model knowledge and clearly separate durable background from time-sensitive claims. Do not fabricate exact current figures. If current or primary-source data is needed, include a short internal_research_plan naming which sources the outer agent should use next, such as get_market_data, read_filings, sec_company_facts, sec_submissions, web_search, or web_fetch.

Return useful context directly; do not apologize and do not discuss data-provider mechanics.`;
}

// Input schema for the get_financials tool
const GetFinancialsInputSchema = z.object({
  query: z.string().describe('Natural language query about financial data'),
});

/**
 * Create a get_financials tool configured with the specified model.
 * Uses native LLM tool calling for routing queries to finance tools.
 */
export function createGetFinancials(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'get_financials',
    description: `Intelligent meta-tool for retrieving Halal Terminal company financial context. Takes a natural language query and automatically routes to Halal Terminal-backed tools. Use for:
- Asset profiles, database records, and current quote context
- Market cap, price, volume, and 52-week quote fields
- Dividend history
- SEC XBRL company facts exposed by Halal Terminal
- Broad company context needed for Shariah-aware research`,
    schema: GetFinancialsInputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      // 1. Call LLM with finance tools bound (native tool calling)
      onProgress?.('Fetching...');
      const { response } = await callLlm(input.query, {
        model,
        systemPrompt: buildRouterPrompt(),
        tools: FINANCE_TOOLS,
      });
      const aiMessage = response as AIMessage;

      // 2. Check for tool calls
      const toolCalls = aiMessage.tool_calls as ToolCall[];
      if (!toolCalls || toolCalls.length === 0) {
        onProgress?.('Building context...');
        try {
          const { response: fallbackResponse } = await callLlm(input.query, {
            model,
            systemPrompt: buildFallbackPrompt(),
          });
          return formatToolResult({
            source: 'model_context',
            query: input.query,
            synthesis: contentToText((fallbackResponse as AIMessage).content ?? fallbackResponse),
            internal_research_plan: [
              'Use get_market_data for current quote, OHLC, trending, or news context.',
              'Use read_filings, sec_company_facts, or sec_submissions for issuer filings and primary-source facts.',
              'Use web_search or web_fetch for time-sensitive estimates, commentary, transcripts, or issuer pages.',
              'Use get_shariah when the answer needs compliance, purification, ETF, or portfolio context.',
            ],
          }, []);
        } catch (error) {
          return formatToolResult({
            source: 'model_context',
            query: input.query,
            synthesis: 'Use primary filings, recent market data, and web sources to complete this request.',
            internal_research_plan: [
              'read_filings',
              'sec_company_facts',
              'sec_submissions',
              'get_market_data',
              'web_search',
            ],
            fallbackError: error instanceof Error ? error.message : String(error),
          }, []);
        }
      }

      // 3. Execute tool calls in parallel
      const toolNames = [...new Set(toolCalls.map(tc => formatSubToolName(tc.name)))];
      onProgress?.(`Fetching from ${toolNames.join(', ')}...`);
      const results = await Promise.all(
        toolCalls.map(async (tc) => {
          try {
            const tool = FINANCE_TOOL_MAP.get(tc.name);
            if (!tool) {
              throw new Error(`Tool '${tc.name}' not found`);
            }
            const rawResult = await tool.invoke(tc.args);
            const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
            const parsed = JSON.parse(result);
            return {
              tool: tc.name,
              args: tc.args,
              data: parsed.data,
              sourceUrls: parsed.sourceUrls || [],
              error: null,
            };
          } catch (error) {
            return {
              tool: tc.name,
              args: tc.args,
              data: null,
              sourceUrls: [],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      // 4. Combine results
      const successfulResults = results.filter((r) => r.error === null);
      const failedResults = results.filter((r) => r.error !== null);

      // Collect all source URLs
      const allUrls = results.flatMap((r) => r.sourceUrls);

      // Build combined data structure
      const combinedData: Record<string, unknown> = {};

      for (const result of successfulResults) {
        // Use tool name as key, or tool_ticker for multiple calls to same tool
        const ticker = (result.args as Record<string, unknown>).ticker as string | undefined;
        const key = ticker ? `${result.tool}_${ticker}` : result.tool;
        combinedData[key] = result.data;
      }

      // Add errors if any
      if (failedResults.length > 0) {
        combinedData._errors = failedResults.map((r) => ({
          tool: r.tool,
          args: r.args,
          error: r.error,
        }));
      }

      return formatToolResult(combinedData, allUrls);
    },
  });
}
