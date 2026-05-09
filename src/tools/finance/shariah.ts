/**
 * Shariah finance tools powered by the Halal Terminal API.
 * https://api.halalterminal.com
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import {
  getHalalTerminalApiKeyOrThrow,
  halalTerminalDelete,
  halalTerminalGet,
  halalTerminalPost,
  halalTerminalRequest,
  halalTerminalText,
} from '../../integrations/halalterminal/client.js';
const UNRESOLVED_REASON_RE = /symbol ['"].+['"] not found in any database/i;

const METHODOLOGY_NAMES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'aaoifi', label: 'AAOIFI' },
  { key: 'djim', label: 'DJIM' },
  { key: 'ftse', label: 'FTSE' },
  { key: 'msci', label: 'MSCI' },
  { key: 'sp', label: 'S&P' },
];

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeSymbols(values: string[]): string[] {
  return values.map(normalizeSymbol);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// The backend exposes per-methodology results under either `methodology_results`
// or `by_methodology` depending on endpoint; the latter uses uppercase keys.
function getMethodologyEntries(record: Record<string, unknown>): Record<string, unknown> | null {
  const direct = asRecord(record.methodology_results);
  if (direct) return direct;
  const byMethodology = asRecord(record.by_methodology);
  if (!byMethodology) return null;
  const normalized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(byMethodology)) {
    normalized[k.toLowerCase()] = v;
  }
  return normalized;
}

function buildVerificationSummary(record: Record<string, unknown>): string | null {
  const entries = getMethodologyEntries(record);
  if (!entries) return null;

  const parts: string[] = [];
  for (const { key, label } of METHODOLOGY_NAMES) {
    const entry = asRecord(entries[key]);
    if (!entry) continue;
    if (entry.verified === true) parts.push(`${label} scholar-verified`);
    else if (entry.verified === false) parts.push(`${label} unverified`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function detectInsufficientData(record: Record<string, unknown>): string | null {
  const top = typeof record.compliance_status === 'string' ? record.compliance_status : null;
  if (top === 'INSUFFICIENT_DATA') {
    return (
      (typeof record.abstain_reason === 'string' && record.abstain_reason) ||
      (typeof record.reason === 'string' && record.reason) ||
      'Insufficient data to render a confident verdict.'
    );
  }

  const entries = getMethodologyEntries(record);
  if (entries) {
    for (const { key } of METHODOLOGY_NAMES) {
      const entry = asRecord(entries[key]);
      if (entry?.status === 'INSUFFICIENT_DATA') {
        return (
          (typeof entry.reason === 'string' && entry.reason) ||
          'Insufficient data on at least one methodology to render a confident verdict.'
        );
      }
    }
  }

  // The stock screen endpoint signals abstain via data_quality.methodologies_insufficient
  // rather than a per-methodology status field — read it as a co-equal source.
  const dataQuality = asRecord(record.data_quality);
  if (dataQuality) {
    const insufficient = Array.isArray(dataQuality.methodologies_insufficient)
      ? (dataQuality.methodologies_insufficient as unknown[]).filter(
          (m): m is string => typeof m === 'string',
        )
      : [];
    if (insufficient.length > 0) {
      const missingFields = Array.isArray(dataQuality.missing_fields)
        ? (dataQuality.missing_fields as unknown[]).filter((m): m is string => typeof m === 'string')
        : [];
      const fieldsClause = missingFields.length > 0 ? ` (missing: ${missingFields.join(', ')})` : '';
      if (insufficient.length >= METHODOLOGY_NAMES.length) {
        return `All methodologies report insufficient data${fieldsClause}.`;
      }
      return `Insufficient data on ${insufficient.join(', ')}${fieldsClause}.`;
    }
  }

  return null;
}

// Notes from the insights API are overloaded: a backend-failure note ("SEC XBRL
// fetch failed: 403…") signals degradation, but a happy-path note ("Source
// ticker is already Shariah-compliant; no alternative needed.") does not.
// Distinguish on content rather than presence so healthy answers don't carry a
// misleading "degraded" badge.
const DEGRADATION_KEYWORDS = /\b(fail(?:ed|ure)?|error|unavailable|outage|forbidden|denied|timeout|unable|cannot|exceeded)\b/i;

function detectDegradation(record: Record<string, unknown>): string[] {
  if (record.degraded === true) {
    return [typeof record.note === 'string' ? record.note : 'Backend degraded.'];
  }

  if (typeof record.note === 'string') {
    const note = record.note.trim();
    if (note.length > 0 && DEGRADATION_KEYWORDS.test(note)) {
      return [note];
    }
  }

  return [];
}

export function normalizeHalalData(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((entry) => normalizeHalalData(entry));
  }

  if (!data || typeof data !== 'object') {
    return data;
  }

  const record = data as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[key] = normalizeHalalData(value);
  }

  // Unresolved-symbol warning (existing behavior).
  const reason = typeof normalized.business_screen_reason === 'string' ? normalized.business_screen_reason : null;
  const allMethodologiesNull = ['aaoifi_compliant', 'djim_compliant', 'ftse_compliant', 'msci_compliant', 'sp_compliant']
    .every((key) => normalized[key] == null);

  if (
    reason &&
    UNRESOLVED_REASON_RE.test(reason) &&
    normalized.is_compliant === false &&
    allMethodologiesNull
  ) {
    normalized.resolution_status = 'unresolved';
    normalized.app_compliance_status = 'unknown';
    normalized.backend_verdict_warning =
      'Backend could not resolve this symbol. Treat the compliance verdict as unknown rather than a confirmed non-compliant decision.';
  }

  // Methodology verification summary — surfaces scholar-verified vs algorithmic-only methodologies.
  const verificationSummary = buildVerificationSummary(normalized);
  if (verificationSummary && !normalized.verification_summary) {
    normalized.verification_summary = verificationSummary;
  }

  // ETF v2 cert system — disposition replaces binary pass/fail; attestations are scholar-signed strings.
  if (typeof normalized.disposition === 'string' && !normalized.app_compliance_status) {
    normalized.app_compliance_status = normalized.disposition;
    normalized.is_etf = true;
  }

  // INSUFFICIENT_DATA abstain (e.g. ADR financial-currency mismatch).
  const abstainReason = detectInsufficientData(normalized);
  if (abstainReason && !normalized.app_compliance_status) {
    normalized.app_compliance_status = 'abstain';
    normalized.abstain_reason = abstainReason;
  }

  // Degradation contract — insights endpoints return 200 + note when backend deps (SEC) are flaky.
  const degradedSources = detectDegradation(normalized);
  if (degradedSources.length > 0) {
    const existing = Array.isArray(normalized.degraded_sources)
      ? (normalized.degraded_sources as unknown[]).filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [];
    normalized.degraded_sources = [...new Set([...existing, ...degradedSources])];
  }

  return normalized;
}

async function halalGet(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: unknown; url: string }> {
  const response = await halalTerminalGet(path, params);
  return { data: normalizeHalalData(response.data), url: response.url };
}

async function halalPost(
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: unknown; url: string }> {
  const response = await halalTerminalPost(path, body, params);
  return { data: normalizeHalalData(response.data), url: response.url };
}

async function halalDelete(path: string): Promise<{ data: unknown; url: string }> {
  const response = await halalTerminalDelete(path);
  return { data: normalizeHalalData(response.data), url: response.url };
}

async function halalText(path: string): Promise<{ data: unknown; url: string }> {
  const response = await halalTerminalText(path);
  return { data: response.data, url: response.url };
}

function createTool<Schema extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: Schema,
  handler: (input: z.infer<Schema>) => Promise<{ data: unknown; url?: string | string[] }>,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name,
    description,
    schema,
    func: async (input) => {
      try {
        const { data, url } = await handler(input as z.infer<Schema>);
        const urls = Array.isArray(url) ? url : url ? [url] : [];
        return formatToolResult(data, urls);
      } catch (err) {
        return formatToolResult({ error: err instanceof Error ? err.message : String(err) }, []);
      }
    },
  });
}

const symbolSchema = z.string().describe("Ticker symbol (e.g. 'AAPL', 'MSFT', 'SPY').");
const symbolsSchema = z.array(z.string()).min(1).describe("List of ticker symbols (e.g. ['AAPL','MSFT']).");
const pageSchema = z.number().int().positive().optional().default(1);
const pageSizeSchema = z.number().int().positive().optional().default(20);

export const screenStockShariah = createTool(
  'screen_stock_shariah',
  'Screen a single stock for Shariah compliance across AAOIFI, DJIM, FTSE, MSCI, and S&P methodologies.',
  z.object({ symbol: symbolSchema }),
  async (input) => {
    const symbol = normalizeSymbol(input.symbol);
    return halalPost(`/api/screen/${symbol}`, {});
  },
);

export const scanPortfolioShariah = createTool(
  'scan_portfolio_shariah',
  'Screen a portfolio of stocks for Shariah compliance and return per-symbol results plus a summary.',
  z.object({
    symbols: symbolsSchema,
    force_refresh: z.boolean().optional().default(false),
  }),
  async (input) =>
    halalPost('/api/portfolio/scan', {
      symbols: normalizeSymbols(input.symbols),
      force_refresh: input.force_refresh ?? false,
    }),
);

export const compareShariah = createTool(
  'compare_shariah',
  'Compare 2-5 stocks side-by-side for Shariah compliance, quotes, and database details.',
  z.object({
    symbols: z.array(z.string()).min(2).max(5),
  }),
  async (input) =>
    halalPost('/api/compare', {
      symbols: normalizeSymbols(input.symbols),
    }),
);

export const screenEtfShariah = createTool(
  'screen_etf_shariah',
  'Screen an ETF for Shariah compliance by analysing each holding and summarising compliant/non-compliant weights.',
  z.object({
    symbol: symbolSchema,
    force_refresh: z.boolean().optional().default(false),
  }),
  async (input) =>
    halalPost(`/api/etf/${normalizeSymbol(input.symbol)}/screen`, {}, {
      force_refresh: input.force_refresh ?? false,
    }),
);

export const compareEtfShariah = createTool(
  'compare_etf_shariah',
  'Compare 2-5 ETFs side-by-side for Shariah compliance and holdings overlap.',
  z.object({
    symbols: z.array(z.string()).min(2).max(5),
  }),
  async (input) =>
    halalPost('/api/etf/compare', {
      symbols: normalizeSymbols(input.symbols),
    }),
);

export const calculateZakat = createTool(
  'calculate_zakat',
  'Calculate zakat owed on a stock portfolio based on market value and the nisab threshold.',
  z.object({
    holdings: z.array(
      z.object({
        symbol: z.string(),
        market_value: z.number().positive(),
      }),
    ).min(1),
    gold_price_per_gram: z.number().positive().optional(),
  }),
  async (input) => {
    const body: Record<string, unknown> = {
      holdings: input.holdings.map((holding) => ({
        symbol: normalizeSymbol(holding.symbol),
        market_value: holding.market_value,
      })),
    };
    if (input.gold_price_per_gram !== undefined) body.gold_price_per_gram = input.gold_price_per_gram;
    return halalPost('/api/zakat/calculate', body);
  },
);

export const calculatePurification = createTool(
  'calculate_purification',
  'Calculate dividend purification amounts for one or more holdings.',
  z.object({
    holdings: z.array(
      z.object({
        symbol: z.string(),
        dividend_income: z.number().nonnegative(),
      }),
    ).min(1),
  }),
  async (input) =>
    halalPost('/api/purification/calculate', {
      holdings: input.holdings.map((holding) => ({
        symbol: normalizeSymbol(holding.symbol),
        dividend_income: holding.dividend_income,
      })),
    }),
);

export const getDividendPurification = createTool(
  'get_dividend_purification',
  'Retrieve dividend history with purification amounts for a single stock.',
  z.object({ symbol: symbolSchema }),
  async (input) => halalGet(`/api/dividends/${normalizeSymbol(input.symbol)}/purification`),
);

export const getDividendHistory = createTool(
  'get_dividend_history',
  'Retrieve chronological dividend history for a single stock from Halal Terminal.',
  z.object({ symbol: symbolSchema }),
  async (input) => halalGet(`/api/dividends/${normalizeSymbol(input.symbol)}`),
);

export const getIslamicNews = createTool(
  'get_islamic_news',
  'Fetch Islamic finance news or company-specific halal investing news.',
  z.object({
    symbol: z.string().optional(),
    category: z.string().optional(),
    q: z.string().optional(),
    page: pageSchema,
    page_size: z.number().int().positive().optional().default(10),
    source: z.string().optional(),
  }),
  async (input) => {
    if (input.symbol) {
      return halalGet(`/api/news/${normalizeSymbol(input.symbol)}`, {
        limit: Math.min(input.page_size ?? 10, 200),
      });
    }
    return halalGet('/api/news', {
      source: input.source,
      category: input.category,
      q: input.q,
      page: input.page ?? 1,
      page_size: Math.min(input.page_size ?? 10, 100),
    });
  },
);

export const getNewsSources = createTool(
  'get_news_sources',
  'List configured Halal Terminal news feed sources.',
  z.object({}),
  async () => halalGet('/api/news/sources'),
);

export const searchHalalDatabase = createTool(
  'search_halal_database',
  'Search the Halal Terminal database of equities, ETFs, or funds with optional filters.',
  z.object({
    q: z.string().optional(),
    asset_type: z.enum(['equities', 'etfs', 'funds']).optional().default('equities'),
    sector: z.string().optional(),
    country: z.string().optional(),
    exchange: z.string().optional(),
    limit: z.number().int().positive().optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
  }),
  async (input) =>
    halalGet('/api/database/search', {
      q: input.q,
      asset_type: input.asset_type ?? 'equities',
      sector: input.sector,
      country: input.country,
      exchange: input.exchange,
      limit: Math.min(input.limit ?? 20, 100),
      offset: input.offset ?? 0,
    }),
);

export const suggestSymbol = createTool(
  'suggest_symbol',
  'Suggest matching ticker symbols for a partial query.',
  z.object({
    q: z.string().describe('Ticker or company prefix to autocomplete.'),
  }),
  async (input) => halalGet('/api/suggest', { q: input.q }),
);

export const getDatabaseStock = createTool(
  'get_database_stock',
  'Retrieve the stored reference-data record for a single symbol.',
  z.object({ symbol: symbolSchema }),
  async (input) => halalGet(`/api/database/stock/${normalizeSymbol(input.symbol)}`),
);

export const getDatabaseStats = createTool(
  'get_database_stats',
  'Get aggregate coverage statistics for the Halal Terminal database.',
  z.object({}),
  async () => halalGet('/api/database/stats'),
);

export const getAssetFull = createTool(
  'get_asset_full',
  'Get an aggregated asset view combining quote, screening, and database data for one symbol.',
  z.object({ symbol: symbolSchema }),
  async (input) => halalGet(`/api/asset/${normalizeSymbol(input.symbol)}/full`),
);

export const getHalalFilings = createTool(
  'get_halal_filings',
  'Retrieve SEC filing metadata for a company from Halal Terminal.',
  z.object({
    symbol: symbolSchema,
    filing_type: z.enum(['10-K', '10-Q', '8-K']).optional(),
    limit: z.number().int().positive().optional().default(10),
  }),
  async (input) =>
    halalGet(`/api/filings/${normalizeSymbol(input.symbol)}`, {
      filing_type: input.filing_type,
      limit: input.limit ?? 10,
    }),
);

export const getHalalFilingFacts = createTool(
  'get_halal_filing_facts',
  'Retrieve XBRL company facts from SEC EDGAR through Halal Terminal.',
  z.object({ symbol: symbolSchema }),
  async (input) => halalGet(`/api/filings/${normalizeSymbol(input.symbol)}/facts`),
);

export const getAllResults = createTool(
  'get_all_results',
  'Retrieve all cached stock screening results currently stored by the backend.',
  z.object({}),
  async () => halalGet('/api/results'),
);

export const getResult = createTool(
  'get_result',
  'Retrieve the latest cached stock screening result for a single symbol.',
  z.object({ symbol: symbolSchema }),
  async (input) => halalGet(`/api/result/${normalizeSymbol(input.symbol)}`),
);

export const getResultsUpdates = createTool(
  'get_results_updates',
  'Get screening results updated since a given ISO-8601 timestamp, optionally filtered by run_id.',
  z.object({
    since: z.string().describe('ISO-8601 timestamp to fetch updates after.'),
    run_id: z.string().optional(),
  }),
  async (input) => halalGet('/api/results/updates', { since: input.since, run_id: input.run_id }),
);

export const getBulkIndices = createTool(
  'get_bulk_indices',
  'List supported stock indices for asynchronous bulk Shariah screening.',
  z.object({}),
  async () => halalGet('/api/screen-bulk/indices'),
);

export const screenIndexBulk = createTool(
  'screen_index_bulk',
  'Trigger a new asynchronous bulk Shariah screening run for an index like SP500 or DJIA.',
  z.object({
    index_name: z.string().describe("Index name such as 'SP500', 'DJIA', or 'NASDAQ100'."),
    limit: z.number().int().positive().optional(),
    force_refresh: z.boolean().optional().default(false),
  }),
  async (input) =>
    halalPost('/api/screen-bulk', {
      index_name: input.index_name,
      limit: input.limit,
      force_refresh: input.force_refresh ?? false,
    }),
);

export const getBulkStatus = createTool(
  'get_bulk_status',
  'Get live status for the active or a specific bulk screening run.',
  z.object({
    run_id: z.string().optional(),
  }),
  async (input) => halalGet('/api/screen-bulk/status', { run_id: input.run_id }),
);

export const listBulkRuns = createTool(
  'list_bulk_runs',
  'List historical bulk screening runs with optional filtering by index or status.',
  z.object({
    index_name: z.string().optional(),
    status: z.string().optional(),
    page: pageSchema,
    page_size: pageSizeSchema,
  }),
  async (input) =>
    halalGet('/api/screen-bulk/runs', {
      index_name: input.index_name,
      status: input.status,
      page: input.page ?? 1,
      page_size: input.page_size ?? 20,
    }),
);

export const compareBulkRuns = createTool(
  'compare_bulk_runs',
  'Compare two bulk screening runs to identify newly compliant and newly non-compliant symbols.',
  z.object({
    run_a: z.string(),
    run_b: z.string(),
  }),
  async (input) => halalGet('/api/screen-bulk/compare', input),
);

export const getBulkResults = createTool(
  'get_bulk_results',
  'Retrieve filtered and paginated results for a bulk screening run.',
  z.object({
    run_id: z.string(),
    compliant: z.boolean().optional(),
    methodology: z.string().optional(),
    sector: z.string().optional(),
    has_error: z.boolean().optional(),
    sort_by: z.string().optional(),
    sort_order: z.enum(['asc', 'desc']).optional().default('asc'),
    page: z.number().int().positive().optional().default(1),
    page_size: z.number().int().positive().optional().default(50),
  }),
  async (input) =>
    halalGet(`/api/screen-bulk/${input.run_id}/results`, {
      compliant: input.compliant,
      methodology: input.methodology,
      sector: input.sector,
      has_error: input.has_error,
      sort_by: input.sort_by,
      sort_order: input.sort_order ?? 'asc',
      page: input.page ?? 1,
      page_size: input.page_size ?? 50,
    }),
);

export const getBulkSummary = createTool(
  'get_bulk_summary',
  'Get aggregate summary statistics for a bulk screening run.',
  z.object({
    run_id: z.string(),
  }),
  async (input) => halalGet(`/api/screen-bulk/${input.run_id}/summary`),
);

export const exportBulkCsv = createTool(
  'export_bulk_csv',
  'Export a bulk screening run as CSV text.',
  z.object({
    run_id: z.string(),
  }),
  async (input) => {
    const { data, url } = await halalText(`/api/screen-bulk/${input.run_id}/export/csv`);
    return { data: { format: 'csv', content: data }, url };
  },
);

export const exportBulkJson = createTool(
  'export_bulk_json',
  'Export a bulk screening run as JSON.',
  z.object({
    run_id: z.string(),
  }),
  async (input) => halalGet(`/api/screen-bulk/${input.run_id}/export/json`),
);

export const cancelBulkRun = createTool(
  'cancel_bulk_run',
  'Cancel a running bulk screening job while preserving partial results.',
  z.object({
    run_id: z.string(),
  }),
  async (input) => halalPost(`/api/screen-bulk/${input.run_id}/cancel`, {}),
);

export const deleteBulkRun = createTool(
  'delete_bulk_run',
  'Delete a bulk screening run and all associated results.',
  z.object({
    run_id: z.string(),
  }),
  async (input) => halalDelete(`/api/screen-bulk/${input.run_id}`),
);

export const getEtfHoldings = createTool(
  'get_etf_holdings',
  'Retrieve the full holdings list for an ETF including weights and any cached compliance statuses.',
  z.object({ symbol: symbolSchema }),
  async (input) => halalGet(`/api/etf/${normalizeSymbol(input.symbol)}/holdings`),
);

export const getEtfInfo = createTool(
  'get_etf_info',
  'Get fund metadata for an ETF including AUM, expense ratio, category, and weightings.',
  z.object({ symbol: symbolSchema }),
  async (input) => halalGet(`/api/etf/${normalizeSymbol(input.symbol)}/info`),
);

export const getEtfScreening = createTool(
  'get_etf_screening',
  'Get the cached ETF Shariah screening result without triggering a new screen.',
  z.object({ symbol: symbolSchema }),
  async (input) => halalGet(`/api/etf/${normalizeSymbol(input.symbol)}/screening`),
);

export const calculateEtfPurification = createTool(
  'calculate_etf_purification',
  'Calculate purification on an ETF investment using investment amount and optional dividend income.',
  z.object({
    symbol: symbolSchema,
    investment_amount: z.number().positive(),
    dividend_income: z.number().nonnegative().optional(),
  }),
  async (input) => {
    const body: Record<string, unknown> = { investment_amount: input.investment_amount };
    if (input.dividend_income !== undefined) body.dividend_income = input.dividend_income;
    return halalPost(`/api/etf/${normalizeSymbol(input.symbol)}/purification`, body);
  },
);

export const screenEtfBulk = createTool(
  'screen_etf_bulk',
  'Screen up to 100 ETFs in one request and return per-ETF compliance with an aggregate summary.',
  z.object({
    symbols: z.array(z.string()).min(1).max(100),
    force_refresh: z.boolean().optional().default(false),
  }),
  async (input) =>
    halalPost('/api/etf/screen-bulk', {
      symbols: normalizeSymbols(input.symbols),
      force_refresh: input.force_refresh ?? false,
    }),
);

export const getScreeningReport = createTool(
  'get_screening_report',
  'Generate a detailed screening report for a single stock.',
  z.object({ symbol: symbolSchema }),
  async (input) => halalGet(`/api/reports/screening/${normalizeSymbol(input.symbol)}`),
);

export const getPortfolioReport = createTool(
  'get_portfolio_report',
  'Generate a report for a list of portfolio symbols including compliance percentage and per-holding details.',
  z.object({
    symbols: symbolsSchema,
  }),
  async (input) =>
    halalPost('/api/reports/portfolio', {
      symbols: normalizeSymbols(input.symbols),
    }),
);

export const exportReportsCsv = createTool(
  'export_reports_csv',
  'Export all cached screening results as CSV text.',
  z.object({}),
  async () => {
    const { data, url } = await halalText('/api/reports/export/csv');
    return { data: { format: 'csv', content: data }, url };
  },
);

export const getGlossary = createTool(
  'get_glossary',
  'Retrieve the Islamic finance glossary, optionally filtered by a search query.',
  z.object({ q: z.string().optional() }),
  async (input) => halalGet('/api/education/glossary', { q: input.q }),
);

export const getMethodologies = createTool(
  'get_methodologies',
  'List all supported Shariah screening methodologies with threshold details.',
  z.object({}),
  async () => halalGet('/api/education/methodologies'),
);

export const getMethodology = createTool(
  'get_methodology',
  'Get detailed information for a specific Shariah methodology such as aaoifi or djim.',
  z.object({
    name: z.string().describe("Methodology id or name such as 'aaoifi', 'djim', or 'msci'."),
  }),
  async (input) => halalGet(`/api/education/methodologies/${input.name}`),
);

export const getScreeningCriteria = createTool(
  'get_screening_criteria',
  'Retrieve the business and financial screening criteria used for Shariah compliance.',
  z.object({}),
  async () => halalGet('/api/education/screening-criteria'),
);

export const getPurificationGuide = createTool(
  'get_purification_guide',
  'Retrieve the backend’s education guide for purification and zakat.',
  z.object({}),
  async () => halalGet('/api/education/purification'),
);

export const getTokenCosts = createTool(
  'get_token_costs',
  'Show the token cost table for Halal Terminal endpoints.',
  z.object({}),
  async () => halalGet('/api/keys/token-costs'),
);

export const getKeyUsage = createTool(
  'get_key_usage',
  'Show usage statistics for the currently configured Halal Terminal API key.',
  z.object({}),
  async () => {
    const apiKey = getHalalTerminalApiKeyOrThrow();
    const response = await halalTerminalRequest('GET', `/api/keys/${encodeURIComponent(apiKey)}/usage`, { apiKey: '' });
    return { data: normalizeHalalData(response.data), url: response.url };
  },
);

export const getDailyUsage = createTool(
  'get_daily_usage',
  'Show per-day request and token usage for the current Halal Terminal API key.',
  z.object({
    days: z.number().int().positive().optional().default(30),
  }),
  async (input) => {
    const apiKey = getHalalTerminalApiKeyOrThrow();
    const response = await halalTerminalRequest('GET', `/api/keys/${encodeURIComponent(apiKey)}/usage/daily`, {
      apiKey: '',
      params: { days: input.days ?? 30 },
    });
    return { data: normalizeHalalData(response.data), url: response.url };
  },
);

export const getRecentRequests = createTool(
  'get_recent_requests',
  'Show recent API requests made with the current Halal Terminal API key.',
  z.object({
    limit: z.number().int().positive().optional().default(20),
  }),
  async (input) => {
    const apiKey = getHalalTerminalApiKeyOrThrow();
    const response = await halalTerminalRequest('GET', `/api/keys/${encodeURIComponent(apiKey)}/usage/recent`, {
      apiKey: '',
      params: { limit: input.limit ?? 20 },
    });
    return { data: normalizeHalalData(response.data), url: response.url };
  },
);

export const listPlans = createTool(
  'list_plans',
  'List available Halal Terminal subscription plans with limits and pricing.',
  z.object({}),
  async () => halalGet('/api/keys/plans'),
);

export const listWatchlists = createTool(
  'list_watchlists',
  'List all watchlists owned by the authenticated Halal Terminal user.',
  z.object({}),
  async () => halalGet('/api/watchlists'),
);

export const createWatchlist = createTool(
  'create_watchlist',
  'Create a named watchlist with optional initial symbols.',
  z.object({
    name: z.string().min(1),
    symbols: z.array(z.string()).optional(),
  }),
  async (input) =>
    halalPost('/api/watchlists', {
      name: input.name,
      ...(input.symbols ? { symbols: normalizeSymbols(input.symbols) } : {}),
    }),
);

export const getWatchlist = createTool(
  'get_watchlist',
  'Retrieve a watchlist by id.',
  z.object({
    watchlist_id: z.string(),
  }),
  async (input) => halalGet(`/api/watchlists/${input.watchlist_id}`),
);

export const deleteWatchlist = createTool(
  'delete_watchlist',
  'Delete a watchlist by id.',
  z.object({
    watchlist_id: z.string(),
  }),
  async (input) => halalDelete(`/api/watchlists/${input.watchlist_id}`),
);

export const addWatchlistSymbol = createTool(
  'add_watchlist_symbol',
  'Add a symbol to an existing watchlist.',
  z.object({
    watchlist_id: z.string(),
    symbol: symbolSchema,
  }),
  async (input) =>
    halalPost(`/api/watchlists/${input.watchlist_id}/symbols`, {
      symbol: normalizeSymbol(input.symbol),
    }),
);

export const removeWatchlistSymbol = createTool(
  'remove_watchlist_symbol',
  'Remove a symbol from an existing watchlist.',
  z.object({
    watchlist_id: z.string(),
    symbol: symbolSchema,
  }),
  async (input) => halalDelete(`/api/watchlists/${input.watchlist_id}/symbols/${normalizeSymbol(input.symbol)}`),
);

export const createCheckout = createTool(
  'create_checkout',
  'Create a Stripe checkout session to upgrade the current Halal Terminal plan.',
  z.object({
    plan: z.enum(['starter', 'pro', 'enterprise']),
  }),
  async (input) =>
    {
      const response = await halalTerminalRequest('POST', '/api/billing/checkout', {
        body: { api_key: getHalalTerminalApiKeyOrThrow(), plan: input.plan },
        apiKey: '',
      });
      return { data: normalizeHalalData(response.data), url: response.url };
    },
);

export const regenerateKey = createTool(
  'regenerate_key',
  'Regenerate the configured Halal Terminal API key. This deactivates the current key and issues a new one.',
  z.object({}),
  async () =>
    {
      const response = await halalTerminalRequest(
        'POST',
        `/api/keys/${encodeURIComponent(getHalalTerminalApiKeyOrThrow())}/regenerate`,
        { apiKey: '' },
      );
      return { data: normalizeHalalData(response.data), url: response.url };
    },
);

export const revokeKey = createTool(
  'revoke_key',
  'Revoke the configured Halal Terminal API key. The key will stop working immediately and cannot be reactivated.',
  z.object({
    confirm: z
      .boolean()
      .describe('Must be true. Required to acknowledge the key will be permanently revoked.'),
  }),
  async (input) => {
    if (!input.confirm) {
      return {
        data: {
          error: 'revoke_key requires confirm=true to proceed. The action is irreversible.',
        },
      };
    }
    const response = await halalTerminalRequest('POST', '/api/keys/revoke', {
      body: { api_key: getHalalTerminalApiKeyOrThrow() },
      apiKey: '',
    });
    return { data: normalizeHalalData(response.data), url: response.url };
  },
);

// =============================================================================
// Predictive compliance insights — Yassir 2.0
//
// Three endpoints that turn the agent from a screener into a watchdog:
//   - trajectory: XBRL-derived ratio history per methodology
//   - staleness:  detects whether a cached screen is outdated relative to recent SEC filings
//   - alternatives: halal substitutes for a non-compliant or drifting holding
// =============================================================================

export const getComplianceTrajectory = createTool(
  'get_compliance_trajectory',
  'Return the historical compliance-ratio trajectory (debt-to-MC, cash-and-securities, non-compliant income) for a symbol, derived from XBRL facts. Use to detect drift toward non-compliance before it happens.',
  z.object({ symbol: symbolSchema }),
  async (input) => {
    const symbol = normalizeSymbol(input.symbol);
    return halalGet(`/api/insights/${symbol}/trajectory`);
  },
);

export const getScreeningStaleness = createTool(
  'get_screening_staleness',
  'Detect whether a cached Shariah screening result is stale, based on recent SEC filings (10-K/10-Q/8-K) since the last screen. Returns a re-screen recommendation.',
  z.object({ symbol: symbolSchema }),
  async (input) => {
    const symbol = normalizeSymbol(input.symbol);
    return halalGet(`/api/insights/${symbol}/staleness`);
  },
);

export const getHalalAlternatives = createTool(
  'get_halal_alternatives',
  'Suggest halal-compliant alternatives for a non-compliant or drifting symbol, ranked by sector match, market cap, and methodology coverage.',
  z.object({ symbol: symbolSchema }),
  async (input) => {
    const symbol = normalizeSymbol(input.symbol);
    return halalGet(`/api/insights/${symbol}/alternatives`);
  },
);
