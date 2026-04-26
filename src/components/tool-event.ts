import { Container, Spacer, Text, type TUI } from '@mariozechner/pi-tui';
import type { ApprovalDecision } from '../agent/types.js';
import { theme } from '../theme.js';
import type { ToolSourceEntry } from '../utils/tool-source-drilldown.js';

function pickVariant(options: readonly string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return options[hash % options.length] ?? options[0] ?? 'Working';
}

function getToolPhaseCategory(name: string): string {
  if (
    [
      'browser',
      'screen_stock_shariah',
      'scan_portfolio_shariah',
      'screen_etf_shariah',
      'screen_index_bulk',
      'get_screening_report',
      'get_portfolio_report',
      'get_etf_screening',
      'get_result',
      'get_bulk_results',
      'get_bulk_summary',
      'get_bulk_status',
    ].includes(name)
  ) {
    return 'screening';
  }
  if (['compare_shariah', 'compare_etf_shariah', 'compare_bulk_runs'].includes(name)) {
    return 'comparing';
  }
  if (
    [
      'get_financials',
      'get_market_data',
      'web_search',
      'x_search',
      'get_etf_info',
      'get_etf_holdings',
      'search_halal_database',
      'suggest_symbol',
      'get_glossary',
      'get_methodologies',
      'get_methodology',
      'get_screening_criteria',
      'get_purification_guide',
      'get_news',
      'get_news_for_symbol',
      'get_filings',
      'get_facts',
    ].includes(name)
  ) {
    return 'researching';
  }
  if (
    [
      'calculate_zakat',
      'calculate_purification',
      'calculate_etf_purification',
      'get_key_usage',
      'get_daily_usage',
      'get_recent_requests',
      'get_token_costs',
      'list_plans',
      'export_bulk_csv',
      'export_bulk_json',
      'export_reports_csv',
    ].includes(name)
  ) {
    return 'analyzing';
  }
  if (
    [
      'list_watchlists',
      'create_watchlist',
      'get_watchlist',
      'add_watchlist_symbol',
      'remove_watchlist_symbol',
      'delete_watchlist',
      'create_checkout',
      'regenerate_key',
      'cancel_bulk_run',
      'delete_bulk_run',
    ].includes(name)
  ) {
    return 'operating';
  }
  if (name === 'skill' || name === 'memory_update') {
    return 'planning';
  }
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
  // Strip common verb prefixes for cleaner display (get_financials → Financials)
  const stripped = name.replace(/^(get)_/, '');
  return stripped
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function truncateAtWord(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  const lastSpace = str.lastIndexOf(' ', maxLength);
  if (lastSpace > maxLength * 0.5) {
    return `${str.slice(0, lastSpace)}...`;
  }
  return `${str.slice(0, maxLength)}...`;
}

function formatArgs(tool: string, args: Record<string, unknown>): string {
  if ('query' in args) {
    const query = String(args.query);
    return theme.muted(`"${truncateAtWord(query, 60)}"`);
  }
  if (tool === 'memory_update') {
    const text = String(args.content ?? args.old_text ?? '').replace(/\n/g, ' ');
    if (text) return theme.muted(truncateAtWord(text, 80));
  }
  return theme.muted(
    Object.entries(args)
      .map(([key, value]) => `${key}=${truncateAtWord(String(value).replace(/\n/g, '\\n'), 60)}`)
      .join(', '),
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function approvalLabel(decision: ApprovalDecision): string {
  switch (decision) {
    case 'allow-once':
      return 'Approved';
    case 'allow-session':
      return 'Approved (session)';
    case 'deny':
      return 'Denied';
  }
}

export class ToolEventComponent extends Container {
  private readonly tui: TUI;
  private readonly header: Text;
  private readonly sourceTrace: Text | null;
  private completedDetails: Text[] = [];
  private sourceEntries: ToolSourceEntry[] = [];
  private sourceDetails: Text[] = [];
  private sourcesExpanded = false;
  private activeDetail: Text | null = null;
  private activeMessage = 'Searching...';
  private activeSince: number | null = null;
  private activeTimer: Timer | null = null;

  constructor(
    tui: TUI,
    stepNumber: number,
    tool: string,
    args: Record<string, unknown>,
    sourceReason?: string,
  ) {
    super();
    this.tui = tui;
    this.addChild(new Spacer(1));
    const title = `${formatToolName(tool)}${args ? `${theme.muted('(')}${formatArgs(tool, args)}${theme.muted(')')}` : ''}`;
    const phase = formatToolPhase(tool, String(stepNumber));
    this.header = new Text(
      `⏺ ${theme.muted(`Step ${String(stepNumber).padStart(2, '0')} · `)}${theme.primary(`${phase} · `)}${title}`,
      0,
      0,
    );
    this.addChild(this.header);
    this.sourceTrace = sourceReason
      ? new Text(`${theme.muted('⎿  Source: ')}${theme.muted(sourceReason)}`, 0, 0)
      : null;
    if (this.sourceTrace) {
      this.addChild(this.sourceTrace);
    }
  }

  setActive(progressMessage?: string) {
    if (!this.activeSince) {
      this.activeSince = Date.now();
    }
    this.activeMessage = progressMessage || this.activeMessage || 'Searching...';
    this.ensureActiveDetail();
    this.startTimer();
    this.renderActiveDetail();
  }

  setComplete(summary: string, duration: number) {
    this.clearDetail();
    const detail = new Text(
      `${theme.muted('⎿  ')}${summary}${theme.muted(` in ${formatDuration(duration)}`)}${
        this.sourceEntries.length > 0 ? theme.muted('  ·  press s for sources') : ''
      }`,
      0,
      0
    );
    this.completedDetails.push(detail);
    this.addChild(detail);
    this.renderSourceDetails();
  }

  setError(error: string) {
    this.clearDetail();
    const detail = new Text(`${theme.muted('⎿  ')}${theme.error(`Error: ${truncateAtWord(error, 80)}`)}`, 0, 0);
    this.completedDetails.push(detail);
    this.addChild(detail);
  }

  setLimitWarning(warning?: string) {
    this.activeMessage = truncateAtWord(warning || 'Approaching suggested limit', 100);
    this.ensureActiveDetail();
    this.startTimer();
    this.renderActiveDetail(true);
  }

  setDenied(path: string, tool: string) {
    this.clearDetail();
    const action = tool === 'write_file' ? 'write to' : tool === 'edit_file' ? 'edit of' : tool;
    const detail = new Text(`${theme.muted('⎿  ')}${theme.warning(`User denied ${action} ${path}`)}`, 0, 0);
    this.completedDetails.push(detail);
    this.addChild(detail);
  }

  setApproval(decision: ApprovalDecision) {
    this.clearDetail();
    const color = decision !== 'deny' ? theme.primary : theme.warning;
    const detail = new Text(`${theme.muted('⎿  ')}${color(approvalLabel(decision))}`, 0, 0);
    this.completedDetails.push(detail);
    this.addChild(detail);
  }

  setSources(entries: ToolSourceEntry[]) {
    this.sourceEntries = entries;
    this.renderSourceDetails();
  }

  hasSources(): boolean {
    return this.sourceEntries.length > 0;
  }

  toggleSources(): boolean {
    if (!this.hasSources()) {
      return false;
    }
    this.sourcesExpanded = !this.sourcesExpanded;
    this.renderSourceDetails();
    this.tui.requestRender();
    return true;
  }

  private clearDetail() {
    this.stopTimer();
    this.activeSince = null;
    if (this.activeDetail) {
      this.removeChild(this.activeDetail);
      this.activeDetail = null;
    }
  }

  private ensureActiveDetail() {
    if (this.activeDetail) {
      return;
    }
    this.activeDetail = new Text('', 0, 0);
    this.addChild(this.activeDetail);
  }

  private startTimer() {
    if (this.activeTimer) {
      return;
    }
    this.activeTimer = setInterval(() => {
      this.renderActiveDetail();
      this.tui.requestRender();
    }, 250);
  }

  private stopTimer() {
    if (!this.activeTimer) {
      return;
    }
    clearInterval(this.activeTimer);
    this.activeTimer = null;
  }

  private renderActiveDetail(isWarning = false) {
    if (!this.activeDetail) {
      return;
    }
    const elapsed = this.activeSince ? theme.muted(` · ${formatDuration(Date.now() - this.activeSince)}`) : '';
    const message = isWarning ? theme.warning(this.activeMessage) : this.activeMessage;
    this.activeDetail.setText(`${theme.muted('⎿  ')}${message}${elapsed}`);
  }

  private renderSourceDetails() {
    for (const detail of this.sourceDetails) {
      this.removeChild(detail);
    }
    this.sourceDetails = [];

    if (!this.sourcesExpanded || this.sourceEntries.length === 0) {
      return;
    }

    for (const entry of this.sourceEntries) {
      const line = `${theme.muted('   · ')}${entry.label}${
        entry.meta ? theme.muted(`  ·  ${entry.meta}`) : ''
      }${entry.url ? theme.muted(`  ·  ${entry.url}`) : ''}`;
      const detail = new Text(line, 0, 0);
      this.sourceDetails.push(detail);
      this.addChild(detail);
    }
  }
}
