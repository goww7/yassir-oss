// Ported from src/components/tool-event.ts

import { summarizeGetShariahData } from '../../../src/utils/summarize-get-shariah-result';

function pickVariant(options: readonly string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return options[hash % options.length] ?? options[0] ?? 'Working';
}

function getToolPhaseCategory(name: string): string {
  if (
    ['browser', 'screen_stock_shariah', 'scan_portfolio_shariah', 'screen_etf_shariah',
     'screen_index_bulk', 'get_screening_report', 'get_portfolio_report', 'get_etf_screening',
     'get_result', 'get_bulk_results', 'get_bulk_summary', 'get_bulk_status'].includes(name)
  ) return 'screening';
  if (['compare_shariah', 'compare_etf_shariah', 'compare_bulk_runs'].includes(name)) return 'comparing';
  if (
    ['get_financials', 'get_market_data', 'web_search', 'x_search', 'get_etf_info',
     'get_etf_holdings', 'search_halal_database', 'suggest_symbol', 'get_glossary',
     'get_methodologies', 'get_methodology', 'get_screening_criteria', 'get_purification_guide',
     'get_news', 'get_news_for_symbol', 'get_filings', 'get_facts',
     'cve_search', 'exploit_db_search', 'shodan_search', 'threat_intel',
     'mitre_attack_search', 'cisa_kev_search', 'cert_transparency_search', 'epss_score',
     'github_advisory_search', 'dns_recon', 'hackingtool_bridge'].includes(name)
  ) return 'researching';
  if (
    ['calculate_zakat', 'calculate_purification', 'calculate_etf_purification',
     'get_key_usage', 'get_daily_usage', 'get_recent_requests', 'get_token_costs',
     'list_plans', 'export_bulk_csv', 'export_bulk_json', 'export_reports_csv'].includes(name)
  ) return 'analyzing';
  if (
    ['list_watchlists', 'create_watchlist', 'get_watchlist', 'add_watchlist_symbol',
     'remove_watchlist_symbol', 'delete_watchlist', 'create_checkout', 'regenerate_key',
     'cancel_bulk_run', 'delete_bulk_run', 'security_exec'].includes(name)
  ) return 'operating';
  if (name === 'skill' || name === 'memory_update') return 'planning';
  return 'working';
}

export function formatToolPhase(name: string, seed = ''): string {
  const category = getToolPhaseCategory(name);
  const variants: Record<string, readonly string[]> = {
    planning: ['Planning', 'Scoping', 'Mapping'],
    researching: ['Researching', 'Inspecting', 'Checking'],
    screening: ['Screening', 'Reviewing', 'Scanning'],
    comparing: ['Comparing', 'Cross-checking', 'Weighing'],
    analyzing: ['Analyzing', 'Assessing', 'Sizing'],
    operating: ['Operating', 'Applying', 'Running'],
    working: ['Working', 'Processing', 'Handling'],
  };
  return pickVariant(variants[category] ?? variants.working, `${name}:${seed}`);
}

export function formatToolName(name: string): string {
  const stripped = name.replace(/^(get)_/, '');
  return stripped.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function summarizeToolResult(tool: string, args: Record<string, unknown>, result: string): string {
  if (tool === 'skill') return `Loaded ${args.skill} skill`;
  try {
    const parsed = JSON.parse(result);
    if (parsed.data) {
      if (Array.isArray(parsed.data)) return `Received ${parsed.data.length} items`;
      if (typeof parsed.data === 'object') {
        const data = parsed.data as Record<string, unknown>;
        if (tool === 'screen_index_bulk') {
          const name = (data.index_name as string) ?? (args.index_name as string) ?? 'Bulk run';
          const total = typeof data.total === 'number' ? data.total : typeof data.count === 'number' ? data.count : null;
          return `${name} queued${total ? ` · ${total} symbols` : ''}`;
        }
        if (tool === 'get_bulk_status') {
          const status = typeof data.status === 'string' ? data.status : 'running';
          const pct = typeof data.progress_pct === 'number' ? `${data.progress_pct.toFixed(1)}%` : null;
          return [status, pct].filter(Boolean).join(' · ');
        }
        if (tool === 'get_bulk_summary') {
          const overall = data.overall as Record<string, unknown> | undefined;
          const rate = overall && typeof overall.compliance_rate === 'number' ? `${overall.compliance_rate.toFixed(1)}% compliant` : null;
          const screened = typeof data.total_screened === 'number' ? `${data.total_screened} screened` : null;
          return [screened, rate].filter(Boolean).join(' · ') || 'Bulk summary ready';
        }
        if (tool === 'get_shariah') {
          return summarizeGetShariahData(data);
        }
        const keys = Object.keys(parsed.data).filter((k) => !k.startsWith('_'));
        if (['get_financials', 'get_market_data', 'stock_screener'].includes(tool))
          return keys.length === 1 ? 'Called 1 data source' : `Called ${keys.length} data sources`;
        if (tool === 'web_search') return 'Did 1 search';
        return `Received ${keys.length} fields`;
      }
    }
  } catch { /* ignore */ }
  return 'Received data';
}
