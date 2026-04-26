/**
 * get_shariah — intelligent meta-tool for Shariah finance queries.
 *
 * Routes natural language queries about Islamic finance to the appropriate
 * Halal Terminal API tools: stock/ETF compliance screening, portfolio scans,
 * side-by-side comparisons, zakat calculation, dividend purification,
 * Islamic news, and the halal stock database.
 */

import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';
import { getHalalTerminalDashboardUrl } from '../../integrations/halalterminal/client.js';
import {
  screenStockShariah,
  scanPortfolioShariah,
  compareShariah,
  screenEtfShariah,
  compareEtfShariah,
  calculateZakat,
  calculatePurification,
  getDividendPurification,
  getDividendHistory,
  getIslamicNews,
  getNewsSources,
  searchHalalDatabase,
  suggestSymbol,
  getDatabaseStock,
  getDatabaseStats,
  getAssetFull,
  getHalalFilings,
  getHalalFilingFacts,
  getAllResults,
  getResult,
  getResultsUpdates,
  getBulkIndices,
  screenIndexBulk,
  getBulkStatus,
  listBulkRuns,
  compareBulkRuns,
  getBulkResults,
  getBulkSummary,
  exportBulkCsv,
  exportBulkJson,
  cancelBulkRun,
  deleteBulkRun,
  getEtfHoldings,
  getEtfInfo,
  getEtfScreening,
  calculateEtfPurification,
  screenEtfBulk,
  getScreeningReport,
  getPortfolioReport,
  exportReportsCsv,
  getGlossary,
  getMethodologies,
  getMethodology,
  getScreeningCriteria,
  getPurificationGuide,
  getTokenCosts,
  getKeyUsage,
  getDailyUsage,
  getRecentRequests,
  listPlans,
  listWatchlists,
  createWatchlist,
  getWatchlist,
  deleteWatchlist,
  addWatchlistSymbol,
  removeWatchlistSymbol,
  createCheckout,
  regenerateKey,
} from './shariah.js';

export const GET_SHARIAH_DESCRIPTION = `
Intelligent meta-tool for Islamic finance and Shariah compliance queries. Routes natural language questions to the appropriate Halal Terminal API tools.

## When to Use

- Checking if a stock is halal / Shariah-compliant (e.g. "Is Apple halal?", "TSLA shariah status")
- Scanning a portfolio of stocks for compliance (e.g. "Screen my portfolio: AAPL, MSFT, GOOGL")
- Comparing stocks side-by-side for halal status (e.g. "Compare AAPL vs MSFT compliance")
- Screening ETFs for Shariah compliance (e.g. "Is QQQ halal?", "Screen SPY ETF")
- Comparing ETFs by halal compliance (e.g. "Which is more halal: HLAL or SPUS?")
- Calculating zakat on a stock portfolio
- Calculating dividend purification (cleansing) amounts
- Reading dividend history, SEC filing metadata, or XBRL facts from Halal Terminal
- Getting Islamic finance news or news about a specific halal stock
- Finding halal stocks by sector, country, or exchange
- Running bulk index screening and reviewing bulk runs/results
- Inspecting ETF holdings, ETF info, cached ETF screening, and ETF purification
- Reading methodology, glossary, screening criteria, and purification reference material
- Checking backend quota, pricing, and recent API usage
- Managing watchlists or opening checkout flows when the user explicitly asks
- Any question involving halal investing, Islamic finance, Shariah screening, zakat, or purification

## When NOT to Use

- Standard financial statements or ratios (use get_financials)
- Current stock prices or market data (use get_market_data)
- SEC filings (use read_filings)
- General stock screening by valuation metrics (use stock_screener)
- General web searches (use web_search)

## Usage Notes

- Call ONCE with a complete natural language query — routes internally
- Handles ticker resolution (Apple → AAPL, S&P 500 ETF → SPY)
- Returns Shariah compliance verdicts with AAOIFI, DJIM, FTSE, MSCI, S&P breakdowns
`.trim();

// All Shariah sub-tools
const SHARIAH_TOOLS: StructuredToolInterface[] = [
  screenStockShariah,
  scanPortfolioShariah,
  compareShariah,
  screenEtfShariah,
  compareEtfShariah,
  calculateZakat,
  calculatePurification,
  getDividendPurification,
  getDividendHistory,
  getIslamicNews,
  getNewsSources,
  searchHalalDatabase,
  suggestSymbol,
  getDatabaseStock,
  getDatabaseStats,
  getAssetFull,
  getHalalFilings,
  getHalalFilingFacts,
  getAllResults,
  getResult,
  getResultsUpdates,
  getBulkIndices,
  screenIndexBulk,
  getBulkStatus,
  listBulkRuns,
  compareBulkRuns,
  getBulkResults,
  getBulkSummary,
  exportBulkCsv,
  exportBulkJson,
  cancelBulkRun,
  deleteBulkRun,
  getEtfHoldings,
  getEtfInfo,
  getEtfScreening,
  calculateEtfPurification,
  screenEtfBulk,
  getScreeningReport,
  getPortfolioReport,
  exportReportsCsv,
  getGlossary,
  getMethodologies,
  getMethodology,
  getScreeningCriteria,
  getPurificationGuide,
  getTokenCosts,
  getKeyUsage,
  getDailyUsage,
  getRecentRequests,
  listPlans,
  listWatchlists,
  createWatchlist,
  getWatchlist,
  deleteWatchlist,
  addWatchlistSymbol,
  removeWatchlistSymbol,
  createCheckout,
  regenerateKey,
];

const SHARIAH_TOOL_MAP = new Map(SHARIAH_TOOLS.map((t) => [t.name, t]));

type PlannedToolCall = {
  name: string;
  args: Record<string, unknown>;
};

type ExecutedToolResult = {
  tool: string;
  args: Record<string, unknown>;
  data: unknown;
  sourceUrls: string[];
  error: string | null;
  meta: {
    role: 'planning' | 'cache_probe' | 'primary' | 'fallback';
    cacheSatisfied?: boolean;
    issue?: ShariahIssue;
    triggeredBy?: string;
  };
};

type ShariahIssue = 'none' | 'quota' | 'unresolved' | 'not_found' | 'empty' | 'other_error';

const EXPENSIVE_SHARIAH_TOOLS = new Set([
  'screen_stock_shariah',
  'scan_portfolio_shariah',
  'compare_shariah',
  'screen_etf_shariah',
  'compare_etf_shariah',
  'screen_index_bulk',
  'screen_etf_bulk',
  'get_portfolio_report',
  'get_screening_report',
]);

const BULK_SHARIAH_TOOLS = new Set(['screen_index_bulk', 'screen_etf_bulk']);
const QUOTA_ERROR_RE = /\b(429|quota|quota_exceeded|too many requests|tokens_limit|tokens_used)\b/i;
const NOT_FOUND_RE = /\b(404|not found|no cached screening found|symbol not found)\b/i;
const FRESH_QUERY_RE = /\b(fresh|refresh|re-?screen|rerun|run now|from scratch|force refresh|latest screening|new run)\b/i;
const EXPLICIT_MUTATION_RE = /\b(create|delete|remove|add|open checkout|upgrade|regenerate)\b/i;

function safeParseToolPayload(rawResult: unknown): { data: unknown; sourceUrls: string[]; error: string | null } {
  try {
    const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
    const parsed = JSON.parse(result) as { data?: unknown; sourceUrls?: unknown; error?: unknown };
    const data = parsed.data;
    const sourceUrls = Array.isArray(parsed.sourceUrls)
      ? parsed.sourceUrls.filter((url): url is string => typeof url === 'string')
      : [];
    const topLevelError = typeof parsed.error === 'string' ? parsed.error : null;
    const nestedError =
      data && typeof data === 'object' && 'error' in (data as Record<string, unknown>) &&
      typeof (data as Record<string, unknown>).error === 'string'
        ? ((data as Record<string, unknown>).error as string)
        : null;

    return {
      data,
      sourceUrls,
      error: topLevelError ?? nestedError,
    };
  } catch (error) {
    return {
      data: null,
      sourceUrls: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getSymbolFromArgs(args: Record<string, unknown>): string | undefined {
  return typeof args.symbol === 'string' ? args.symbol : undefined;
}

function getSymbolsFromArgs(args: Record<string, unknown>): string[] {
  if (Array.isArray(args.symbols)) {
    return args.symbols.filter((value): value is string => typeof value === 'string');
  }
  const symbol = getSymbolFromArgs(args);
  return symbol ? [symbol] : [];
}

export function classifyShariahIssue(result: { data: unknown; error: string | null }): ShariahIssue {
  const errorText = result.error ?? '';
  if (errorText) {
    if (QUOTA_ERROR_RE.test(errorText)) return 'quota';
    if (NOT_FOUND_RE.test(errorText)) return 'not_found';
    return 'other_error';
  }

  const data = result.data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (record.resolution_status === 'unresolved' || record.app_compliance_status === 'unknown') {
      return 'unresolved';
    }
    if (Array.isArray(record.results) && record.results.length === 0) return 'empty';
    if (Array.isArray(record.indices) && record.indices.length === 0) return 'empty';
    if (Array.isArray(record.articles) && record.articles.length === 0 && typeof record.total === 'number' && record.total === 0) {
      return 'empty';
    }
  }

  return 'none';
}

function isUsableCacheResult(result: { data: unknown; error: string | null }): boolean {
  const issue = classifyShariahIssue(result);
  return issue === 'none';
}

export function maybePreflightToolCalls(toolCalls: PlannedToolCall[], query: string): PlannedToolCall[] {
  const existing = new Set(toolCalls.map((toolCall) => toolCall.name));
  const hasExpensiveCall = toolCalls.some((toolCall) => EXPENSIVE_SHARIAH_TOOLS.has(toolCall.name));
  const hasBulkCall = toolCalls.some((toolCall) => BULK_SHARIAH_TOOLS.has(toolCall.name));
  const result: PlannedToolCall[] = [];

  if (hasExpensiveCall && !existing.has('get_key_usage')) {
    result.push({ name: 'get_key_usage', args: {} });
  }

  if (hasBulkCall && !existing.has('get_token_costs')) {
    result.push({ name: 'get_token_costs', args: {} });
  }

  if (!EXPLICIT_MUTATION_RE.test(query)) {
    result.push(...toolCalls.filter((toolCall) => ![
      'create_watchlist',
      'delete_watchlist',
      'add_watchlist_symbol',
      'remove_watchlist_symbol',
      'create_checkout',
      'regenerate_key',
    ].includes(toolCall.name)));
    return dedupeToolCalls(result);
  }

  result.push(...toolCalls);
  return dedupeToolCalls(result);
}

function shouldUseCachedFirst(toolName: string, query: string): boolean {
  if (FRESH_QUERY_RE.test(query)) return false;
  return toolName === 'screen_stock_shariah' || toolName === 'screen_etf_shariah';
}

function getCachedFirstCalls(toolCall: PlannedToolCall): PlannedToolCall[] {
  if (toolCall.name === 'screen_stock_shariah') {
    const symbol = getSymbolFromArgs(toolCall.args);
    return symbol ? [{ name: 'get_result', args: { symbol } }] : [];
  }
  if (toolCall.name === 'screen_etf_shariah') {
    const symbol = getSymbolFromArgs(toolCall.args);
    return symbol ? [{ name: 'get_etf_screening', args: { symbol } }] : [];
  }
  return [];
}

export function getFallbackToolCalls(
  toolCall: PlannedToolCall,
  issue: ShariahIssue,
): PlannedToolCall[] {
  const symbol = getSymbolFromArgs(toolCall.args);
  const symbols = getSymbolsFromArgs(toolCall.args);

  switch (toolCall.name) {
    case 'screen_stock_shariah':
      if (!symbol) return [];
      if (issue === 'quota' || issue === 'not_found' || issue === 'other_error') {
        return [
          { name: 'get_result', args: { symbol } },
          { name: 'get_database_stock', args: { symbol } },
        ];
      }
      if (issue === 'unresolved' || issue === 'empty') {
        return [
          { name: 'suggest_symbol', args: { q: symbol } },
          { name: 'search_halal_database', args: { q: symbol, asset_type: 'equities', limit: 5 } },
        ];
      }
      return [];
    case 'scan_portfolio_shariah':
    case 'compare_shariah':
    case 'get_portfolio_report':
      if (issue === 'quota' || issue === 'not_found' || issue === 'other_error') {
        return symbols.slice(0, 10).map((listedSymbol) => ({ name: 'get_result', args: { symbol: listedSymbol } }));
      }
      return [];
    case 'screen_etf_shariah':
      if (!symbol) return [];
      if (issue === 'quota' || issue === 'not_found' || issue === 'other_error') {
        return [
          { name: 'get_etf_screening', args: { symbol } },
          { name: 'get_etf_info', args: { symbol } },
        ];
      }
      if (issue === 'unresolved' || issue === 'empty') {
        return [
          { name: 'get_etf_info', args: { symbol } },
          { name: 'get_etf_holdings', args: { symbol } },
        ];
      }
      return [];
    case 'screen_index_bulk':
      return issue === 'quota' || issue === 'not_found' || issue === 'other_error'
        ? [
            { name: 'list_bulk_runs', args: { index_name: toolCall.args.index_name, page: 1, page_size: 5 } },
            { name: 'get_bulk_indices', args: {} },
          ]
        : [];
    case 'screen_etf_bulk':
      return issue === 'quota' || issue === 'not_found' || issue === 'other_error'
        ? symbols.slice(0, 10).map((listedSymbol) => ({ name: 'get_etf_screening', args: { symbol: listedSymbol } }))
        : [];
    case 'get_result':
      return symbol && (issue === 'not_found' || issue === 'empty')
        ? [
            { name: 'suggest_symbol', args: { q: symbol } },
            { name: 'search_halal_database', args: { q: symbol, asset_type: 'equities', limit: 5 } },
          ]
        : [];
    case 'get_etf_screening':
      return symbol && (issue === 'not_found' || issue === 'empty')
        ? [{ name: 'get_etf_info', args: { symbol } }]
        : [];
    default:
      return [];
  }
}

function dedupeToolCalls(toolCalls: PlannedToolCall[]): PlannedToolCall[] {
  const seen = new Set<string>();
  const deduped: PlannedToolCall[] = [];
  for (const toolCall of toolCalls) {
    const key = JSON.stringify({ name: toolCall.name, args: toolCall.args });
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(toolCall);
  }
  return deduped;
}

function uniqueResultKey(
  result: ExecutedToolResult,
  counts: Map<string, number>,
): string {
  const symbol =
    getSymbolFromArgs(result.args) ||
    (Array.isArray(result.args.symbols) ? (result.args.symbols as string[])[0] : undefined);
  const baseKey = symbol ? `${result.tool}_${symbol}` : result.tool;
  const currentCount = counts.get(baseKey) ?? 0;
  counts.set(baseKey, currentCount + 1);
  return currentCount === 0 ? baseKey : `${baseKey}_${currentCount + 1}`;
}

function buildWorkflowSummary(results: ExecutedToolResult[]): Record<string, unknown> {
  const quotaErrors = results.filter((result) => result.meta.issue === 'quota');
  const unresolved = results.filter((result) => result.meta.issue === 'unresolved');
  const directErrors = results.filter((result) => result.error && result.meta.issue !== 'quota');
  const cacheSatisfied = results.some((result) => result.meta.role === 'cache_probe' && result.meta.cacheSatisfied);
  const fallbacks = results.filter((result) => result.meta.role === 'fallback');

  const completeness =
    quotaErrors.length > 0
      ? 'quota_blocked'
      : unresolved.length > 0 || directErrors.length > 0
        ? 'partial'
        : 'complete';

  const recovery =
    completeness === 'quota_blocked'
      ? {
          kind: 'quota_recovery',
          severity: 'action_required',
          title: 'HalalTerminal credits required',
          dashboardUrl: getHalalTerminalDashboardUrl(),
          primaryAction: 'Refill or upgrade your HalalTerminal API plan, then rerun this request.',
          actions: [
            'Open the HalalTerminal dashboard.',
            'Refill credits or upgrade the API plan if usage is exhausted.',
            'Confirm the API key has screening access.',
            'Rerun the exact workflow after credits are restored.',
          ],
        }
      : null;

  return {
    completeness,
    cacheSatisfied,
    fallbackCount: fallbacks.length,
    quotaErrors: quotaErrors.map((result) => ({ tool: result.tool, error: result.error })),
    unresolvedSymbols: unresolved.map((result) => getSymbolFromArgs(result.args) ?? result.tool),
    directErrors: directErrors.map((result) => ({ tool: result.tool, error: result.error })),
    recovery,
    userFacingMessage:
      completeness === 'quota_blocked'
        ? `HalalTerminal credits are exhausted or plan access is blocking live screening. Refill or upgrade here: ${getHalalTerminalDashboardUrl()} Then rerun this request for an authoritative Shariah result.`
        : undefined,
    guidance:
      completeness === 'complete'
        ? 'Data looks sufficient for normal interpretation.'
        : completeness === 'quota_blocked'
          ? `ACTION REQUIRED: HalalTerminal credits or plan access are blocking live screening. Open ${getHalalTerminalDashboardUrl()}, refill credits or upgrade your plan, confirm the API key is active, then rerun this request. Do not present fallback data as a live Shariah forecast.`
        : 'Treat unresolved symbols, quota failures, and fallback-only results as lower-confidence evidence. Do not present them as decisive halal/non-halal verdicts.',
  };
}

function buildRouterPrompt(): string {
  return `You are an Islamic finance assistant specialising in Shariah compliance.
Current date: ${getCurrentDate()}

Given a user query about Shariah compliance or Islamic finance, call the most appropriate tool(s).

## Workflow Rules

- Prefer cached or read-only endpoints before expensive fresh screening when the user did not explicitly ask for refresh, rerun, or force_refresh.
- For single-stock compliance checks, prefer cached results first and only use fresh screening when cache is missing, stale by user request, or insufficient.
- For single-ETF compliance checks, prefer cached ETF screening first and only use fresh ETF screening when explicitly needed.
- For expensive workflows (portfolio scans, ETF bulk, index bulk), check quota/usage first when relevant.
- If a screening call returns quota or token exhaustion, stop the Shariah workflow and make the dashboard refill/upgrade action the primary response.
- If a screening call returns unresolved coverage, symbol-not-found, or partial data, do not stop there if a cheaper fallback can clarify the situation.
- Use bulk/index tools for index-sized workflows. Do not emulate an index screen with many single-symbol calls unless falling back after backend failure.
- Do not choose watchlist, checkout, or key-regeneration actions unless the user explicitly asked for those side effects.
- When backend data is incomplete, prefer returning evidence plus caveats over a confident halal/non-halal verdict.

## Tool Selection Guide

### screen_stock_shariah
Use when asked if a specific STOCK is halal, compliant, or Shariah-screened.
- "Is Apple halal?" → screen_stock_shariah(symbol="AAPL")
- "Check Tesla shariah compliance" → screen_stock_shariah(symbol="TSLA")
- Cached-first rule: if the user did not ask for a fresh rerun, prefer get_result(symbol=...) before triggering fresh screening.
- For multiple stocks, call once per ticker only for small sets. Use compare_shariah or scan_portfolio_shariah when more appropriate.

### scan_portfolio_shariah
Use when asked to screen a LIST of stocks as a portfolio.
- "Screen my portfolio: AAPL, MSFT, GOOGL, AMZN" → scan_portfolio_shariah(symbols=["AAPL","MSFT","GOOGL","AMZN"])
- Prefer this over multiple screen_stock_shariah calls for 4+ symbols.

### compare_shariah
Use when asked to COMPARE 2-5 stocks side-by-side for compliance.
- "Compare AAPL vs MSFT halal status" → compare_shariah(symbols=["AAPL","MSFT"])
- "Which is more halal: Google, Apple, or Amazon?" → compare_shariah(symbols=["GOOGL","AAPL","AMZN"])

### screen_etf_shariah
Use when asked if an ETF is halal or for its per-holding compliance breakdown.
- "Is QQQ halal?" → screen_etf_shariah(symbol="QQQ")
- "Screen the S&P 500 ETF" → screen_etf_shariah(symbol="SPY")
- Cached-first rule: if the user did not ask for refresh, prefer get_etf_screening(symbol=...) before a fresh ETF screen.

### compare_etf_shariah
Use when asked to compare ETFs by Shariah compliance.
- "Which halal ETF is best: HLAL, SPUS, or ISWD?" → compare_etf_shariah(symbols=["HLAL","SPUS","ISWD"])

### calculate_zakat
Use when asked to calculate zakat on stock holdings.
- "Calculate my zakat: $25,000 in AAPL and $18,000 in MSFT"
  → calculate_zakat(holdings=[{symbol:"AAPL",market_value:25000},{symbol:"MSFT",market_value:18000}])
- "I have 100 shares of AAPL at $190 and 50 shares of MSFT at $420, what's my zakat?"
  → calculate_zakat(holdings=[{symbol:"AAPL",market_value:19000},{symbol:"MSFT",market_value:21000}])

### calculate_purification
Use when asked about dividend purification for multiple holdings.
- "I received $320 from MSFT and $150 from AAPL in dividends, how much do I purify?"
  → calculate_purification(holdings=[{symbol:"MSFT",dividend_income:320},{symbol:"AAPL",dividend_income:150}])

### get_dividend_purification
Use when asked for dividend history WITH purification amounts for a single stock.
- "Show MSFT dividend purification history" → get_dividend_purification(symbol="MSFT")
- "How much should I have purified from AAPL dividends?" → get_dividend_purification(symbol="AAPL")

### get_islamic_news
Use when asked for Islamic finance news or news about a specific stock from an Islamic perspective.
- "Latest Islamic finance news" → get_islamic_news(category="islamic_finance")
- "News about AAPL for halal investors" → get_islamic_news(symbol="AAPL")
- "Any news about sukuk or AAOIFI?" → get_islamic_news(q="sukuk AAOIFI")

### search_halal_database
Use when asked to FIND or LIST stocks by sector, country, or exchange.
- "Find halal tech stocks on NASDAQ" → search_halal_database(sector="Technology", exchange="NASDAQ")
- "Show me healthcare companies in Saudi Arabia" → search_halal_database(sector="Healthcare", country="Saudi Arabia")
- "What ETFs are in the database?" → search_halal_database(asset_type="etfs")
- "Find companies named 'Islamic'" → search_halal_database(q="Islamic")

### suggest_symbol / get_database_stock / get_asset_full
Use for symbol resolution, single-name reference data, and unified quote-plus-screen views.
- "What ticker is Badger Meter?" → suggest_symbol(q="Badger Meter")
- "Show the reference record for AAPL" → get_database_stock(symbol="AAPL")
- "Give me the full asset view for MSFT" → get_asset_full(symbol="MSFT")

### get_bulk_indices / screen_index_bulk / get_bulk_status / get_bulk_results / get_bulk_summary
Use for INDEX-level bulk screening workflows.
- "What indices can I bulk screen?" → get_bulk_indices()
- "Screen the S&P 500" → screen_index_bulk(index_name="SP500")
- "Check the status of the current bulk run" → get_bulk_status()
- "Show compliant names from run abc under AAOIFI" → get_bulk_results(run_id="abc", compliant=true, methodology="aaoifi")
- "Summarize the latest SP500 run" → get_bulk_summary(run_id="abc")
- Before launching a new bulk run, consider get_key_usage() if quota may matter.

### list_bulk_runs / compare_bulk_runs / export_bulk_csv / export_bulk_json / cancel_bulk_run / delete_bulk_run
Use for historical bulk-run management.
- "List previous SP500 runs" → list_bulk_runs(index_name="SP500")
- "Compare run_a vs run_b" → compare_bulk_runs(run_a="...", run_b="...")
- "Export run abc as CSV" → export_bulk_csv(run_id="abc")
- "Cancel the running bulk job" → cancel_bulk_run(run_id="abc")

### get_all_results / get_result / get_results_updates
Use for cached screening retrieval and incremental refresh.
- "Show cached result for AAPL" → get_result(symbol="AAPL")
- "What screening results changed since yesterday?" → get_results_updates(since="2026-03-23T00:00:00Z")

### get_etf_holdings / get_etf_info / get_etf_screening / calculate_etf_purification / screen_etf_bulk
Use for deeper ETF workflows.
- "Show HLAL holdings" → get_etf_holdings(symbol="HLAL")
- "Give me SPY fund info" → get_etf_info(symbol="SPY")
- "Use cached screening for QQQ" → get_etf_screening(symbol="QQQ")
- "How much should I purify on $50k in SPUS?" → calculate_etf_purification(symbol="SPUS", investment_amount=50000)
- "Bulk screen HLAL, SPUS, QQQ" → screen_etf_bulk(symbols=["HLAL","SPUS","QQQ"])

### get_screening_report / get_portfolio_report / export_reports_csv
Use for report-style outputs.
- "Generate a screening report for AAPL" → get_screening_report(symbol="AAPL")
- "Generate a portfolio report for AAPL, MSFT, GOOGL" → get_portfolio_report(symbols=["AAPL","MSFT","GOOGL"])

### get_glossary / get_methodologies / get_methodology / get_screening_criteria / get_purification_guide
Use for educational or explanatory questions.
- "Explain AAOIFI thresholds" → get_methodology(name="aaoifi")
- "What are the screening criteria?" → get_screening_criteria()
- "Explain purification" → get_purification_guide()

### get_token_costs / get_key_usage / get_daily_usage / get_recent_requests / list_plans
Use for backend operations, quota, and pricing.
- "How many tokens do I have left?" → get_key_usage()
- "Show recent API requests" → get_recent_requests(limit=10)
- "What does each endpoint cost?" → get_token_costs()
- "What plans exist?" → list_plans()
- These tools are also useful as planning aids before expensive fresh screening.

### list_watchlists / create_watchlist / get_watchlist / delete_watchlist / add_watchlist_symbol / remove_watchlist_symbol
Use ONLY when the user explicitly wants to manage watchlists.
- "Create a halal tech watchlist with AAPL and MSFT" → create_watchlist(name="Halal Tech", symbols=["AAPL","MSFT"])
- "Add NVDA to watchlist wl_123" → add_watchlist_symbol(watchlist_id="wl_123", symbol="NVDA")

### create_checkout / regenerate_key
Use ONLY when the user explicitly wants plan upgrades or key rotation.
- "Open checkout for the starter plan" → create_checkout(plan="starter")
- "Regenerate my Halal Terminal key" → regenerate_key()

## Ticker Resolution
Apple → AAPL, Tesla → TSLA, Microsoft → MSFT, Amazon → AMZN, Google/Alphabet → GOOGL
Meta/Facebook → META, Nvidia → NVDA, Netflix → NFLX, Saudi Aramco → 2222.SR
Halal ETF → HLAL, SP Shariah ETF → SPUS, iShares MSCI World Islamic → ISWD
S&P 500 ETF → SPY, Nasdaq ETF → QQQ, Vanguard Total Market → VTI

Call the appropriate tool(s) now. When uncertain, choose the lower-cost read/cached option first, then escalate only if needed.`;
}

function formatSubToolName(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const GetShariahInputSchema = z.object({
  query: z
    .string()
    .describe(
      'Natural language query about Shariah compliance, halal investing, zakat, purification, or Islamic finance',
    ),
});

/**
 * Create a get_shariah tool configured with the specified model.
 * Uses native LLM tool calling to route queries to the appropriate Shariah sub-tools.
 */
export function createGetShariah(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'get_shariah',
    description: `Intelligent meta-tool for Islamic finance and Shariah compliance. Takes a natural language query and routes to appropriate Halal Terminal API tools. Use for:
- Checking if a stock or ETF is halal / Shariah-compliant
- Scanning a portfolio of stocks for compliance
- Comparing stocks or ETFs side-by-side for halal status
- Running index bulk screens and reading cached/bulk results
- Managing ETF holdings/info/purification and ETF bulk screens
- Calculating zakat on a stock portfolio
- Calculating dividend purification (cleansing) amounts
- Getting Islamic finance news
- Finding halal stocks by sector, country, or exchange
- Explaining methodologies, screening criteria, glossary terms, and purification guidance
- Checking quota, usage, token pricing, and plans
- Managing watchlists or checkout flows when explicitly requested`,
    schema: GetShariahInputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      // 1. LLM routes the query to the right sub-tool(s) via native tool calling
      onProgress?.('Analysing Shariah compliance query...');
      const { response } = await callLlm(input.query, {
        model,
        systemPrompt: buildRouterPrompt(),
        tools: SHARIAH_TOOLS,
      });
      const aiMessage = response as AIMessage;

      // 2. Verify tool calls were generated
      const toolCalls = aiMessage.tool_calls as ToolCall[];
      if (!toolCalls || toolCalls.length === 0) {
        return formatToolResult({ error: 'No Shariah tools selected for query' }, []);
      }

      const plannedCalls = maybePreflightToolCalls(
        toolCalls.map((toolCall) => ({
          name: toolCall.name,
          args: toolCall.args as Record<string, unknown>,
        })),
        input.query,
      );

      const invokeSingle = async (
        toolCall: PlannedToolCall,
        role: ExecutedToolResult['meta']['role'],
        triggeredBy?: string,
      ): Promise<ExecutedToolResult> => {
        try {
          const tool = SHARIAH_TOOL_MAP.get(toolCall.name);
          if (!tool) throw new Error(`Shariah tool '${toolCall.name}' not found`);
          const rawResult = await tool.invoke(toolCall.args);
          const parsed = safeParseToolPayload(rawResult);
          return {
            tool: toolCall.name,
            args: toolCall.args,
            data: parsed.data,
            sourceUrls: parsed.sourceUrls,
            error: parsed.error,
            meta: {
              role,
              issue: classifyShariahIssue(parsed),
              triggeredBy,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            tool: toolCall.name,
            args: toolCall.args,
            data: null,
            sourceUrls: [],
            error: message,
            meta: {
              role,
              issue: classifyShariahIssue({ data: null, error: message }),
              triggeredBy,
            },
          };
        }
      };

      const executeWithStrategy = async (toolCall: PlannedToolCall): Promise<ExecutedToolResult[]> => {
        const outputs: ExecutedToolResult[] = [];

        if (shouldUseCachedFirst(toolCall.name, input.query)) {
          const cachedCalls = getCachedFirstCalls(toolCall);
          for (const cachedCall of cachedCalls) {
            const cachedResult = await invokeSingle(cachedCall, 'cache_probe', toolCall.name);
            if (isUsableCacheResult(cachedResult)) {
              cachedResult.meta.cacheSatisfied = true;
              outputs.push(cachedResult);
              return outputs;
            }
            outputs.push(cachedResult);
          }
        }

        const primaryResult = await invokeSingle(toolCall, EXPENSIVE_SHARIAH_TOOLS.has(toolCall.name) ? 'primary' : 'planning');
        outputs.push(primaryResult);

        const issue = primaryResult.meta.issue ?? 'none';
        if (issue !== 'none') {
          if (issue === 'quota') {
            return outputs;
          }
          const fallbackCalls = dedupeToolCalls(getFallbackToolCalls(toolCall, issue));
          for (const fallbackCall of fallbackCalls) {
            const fallbackResult = await invokeSingle(fallbackCall, 'fallback', toolCall.name);
            outputs.push(fallbackResult);
          }
        }

        return outputs;
      };

      // 3. Execute sub-tool calls with preflight, cache probes, and targeted fallbacks
      const toolNames = [...new Set(plannedCalls.map((tc) => formatSubToolName(tc.name)))];
      onProgress?.(`Fetching from ${toolNames.join(', ')}...`);

      const resultGroups = await Promise.all(plannedCalls.map((toolCall) => executeWithStrategy(toolCall)));
      const results = resultGroups.flat();
      const workflowSummary = buildWorkflowSummary(results);

      // 4. Combine results into a single response
      const allUrls = [
        ...results.flatMap((r) => r.sourceUrls),
        ...((workflowSummary.recovery &&
          typeof workflowSummary.recovery === 'object' &&
          typeof (workflowSummary.recovery as { dashboardUrl?: unknown }).dashboardUrl === 'string')
          ? [((workflowSummary.recovery as { dashboardUrl: string }).dashboardUrl)]
          : []),
      ];
      const combinedData: Record<string, unknown> = {};
      const keyCounts = new Map<string, number>();

      for (const result of results.filter((r) => r.error === null)) {
        combinedData[uniqueResultKey(result, keyCounts)] = result.data;
      }

      const failedResults = results.filter((r) => r.error !== null);
      if (failedResults.length > 0) {
        combinedData._errors = failedResults.map((r) => ({
          tool: r.tool,
          args: r.args,
          error: r.error,
        }));
      }

      combinedData._workflow = workflowSummary;

      return formatToolResult(combinedData, allUrls);
    },
  });
}
