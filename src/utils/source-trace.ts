import { formatToolName } from '../components/tool-event.js';

export type SourceTraceEntry = {
  tool: string;
  label: string;
  reason: string;
};

const SOURCE_TOOLS = new Set([
  'get_financials',
  'get_market_data',
  'read_filings',
  'get_shariah',
  'sec_company_facts',
  'sec_submissions',
  'web_search',
  'x_search',
  'browser',
]);

function queryText(args: Record<string, unknown>): string {
  const value = args.query ?? args.search ?? args.question ?? args.q;
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function isNewsyQuery(query: string): boolean {
  return /(latest|recent|news|today|update|announced|week)/.test(query);
}

export function isSourceTraceTool(tool: string): boolean {
  return SOURCE_TOOLS.has(tool);
}

export function getSourceTraceEntry(
  tool: string,
  args: Record<string, unknown>,
): SourceTraceEntry | null {
  if (!isSourceTraceTool(tool)) {
    return null;
  }

  const query = queryText(args);
  const label = formatToolName(tool);

  switch (tool) {
    case 'get_financials':
      return { tool, label, reason: 'structured fundamentals, metrics, and estimates' };
    case 'get_market_data':
      return { tool, label, reason: 'live prices, market moves, and headline-level recency' };
    case 'read_filings':
      return { tool, label, reason: 'read primary filing text instead of relying on summaries' };
    case 'get_shariah':
      return { tool, label, reason: 'profile-native Shariah screening and compliance data' };
    case 'sec_company_facts':
      return { tool, label, reason: 'official SEC company facts from a primary regulator source' };
    case 'sec_submissions':
      return { tool, label, reason: 'official SEC filing history and reporting cadence' };
    case 'x_search':
      return { tool, label, reason: 'real-time public conversation and market chatter' };
    case 'browser':
      return { tool, label, reason: 'interactive or JavaScript-rendered source inspection' };
    case 'web_search':
      return {
        tool,
        label,
        reason: isNewsyQuery(query)
          ? 'broader current context and recency beyond structured sources'
          : 'broader corroboration beyond profile-specific primary sources',
      };
    default:
      return { tool, label, reason: 'external source lookup' };
  }
}
