import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { AppProfile, ProfileGuidedQaConfig, ProfileGuidedQaWorkflow } from './types.js';
import { logger } from '../utils/logger.js';

const yassirLogo = `
██╗   ██╗ █████╗ ███████╗███████╗██╗██████╗
╚██╗ ██╔╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗
 ╚████╔╝ ███████║███████╗███████╗██║██████╔╝
  ╚██╔╝  ██╔══██║╚════██║╚════██║██║██╔══██╗
   ██║   ██║  ██║███████║███████║██║██║  ██║
   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝╚═╝  ╚═╝`;

const basePalette = {
  primary: '#10b981',
  primaryLight: '#6ee7b7',
  success: '#10b981',
  error: 'red',
  warning: 'yellow',
  muted: '#a6a6a6',
  mutedDark: '#303030',
  accent: '#34d399',
  white: '#ffffff',
  info: '#6ee7b7',
  queryBg: '#3D3D3D',
  border: '#303030',
};

function buildGuidedQaWorkflows(subjectLabel: string): ProfileGuidedQaWorkflow[] {
  return [
    {
      id: 'single_asset_review',
      label: 'Single-Asset Review',
      description: 'Prepare a decision-ready halal review for one stock or ETF.',
      triggerKeywords: ['screen', 'halal', 'shariah', 'review', 'brief', 'stock', 'etf', 'verdict'],
      autoTrigger: 'broad-only',
      executionHint:
        'Use HalalTerminal first. Resolve the symbol if needed, then cover Shariah status, methodology breakdown, business-activity fit, ratio flags, and purification where available.',
      outputSections: [
        'Final verdict',
        'Methodology breakdown',
        'Key reasons',
        'Purification and income-quality notes',
        'Next checks',
      ],
      questions: [
        {
          id: 'security',
          title: 'Security',
          prompt: 'Which stock or ETF should be reviewed?',
          kind: 'text',
          prefillFrom: 'query',
          placeholder: 'Ticker or fund symbol, for example MSFT or HLAL',
          summaryLabel: 'Security',
        },
        {
          id: 'asset_type',
          title: 'Asset Type',
          prompt: 'What kind of security is it?',
          kind: 'single',
          defaultValue: 'auto',
          summaryLabel: 'Asset type',
          options: [
            { value: 'auto', label: 'Auto-detect', description: 'Let Yassir infer whether it is a stock or ETF' },
            { value: 'stock', label: 'Stock', description: 'Single-company Shariah review' },
            { value: 'etf', label: 'ETF', description: 'Fund-level review with holdings context' },
          ],
        },
        {
          id: 'methodology_priority',
          title: 'Methodology Priority',
          prompt: 'Which verdict style should be emphasized?',
          kind: 'single',
          defaultValue: 'consensus',
          summaryLabel: 'Methodology priority',
          options: [
            { value: 'consensus', label: 'Consensus first', description: 'Show the broadest practical read' },
            { value: 'aaoifi', label: 'AAOIFI priority', description: 'Lead with AAOIFI-style interpretation' },
            { value: 'strictest', label: 'Strictest view', description: 'Surface the most conservative read first' },
          ],
        },
        {
          id: 'review_focus',
          title: 'Review Focus',
          prompt: 'What should the review emphasize?',
          kind: 'single',
          defaultValue: 'full_verdict',
          summaryLabel: 'Review focus',
          options: [
            { value: 'full_verdict', label: 'Full verdict', description: 'Balanced decision-ready screening summary' },
            { value: 'methodology_difference', label: 'Methodology differences', description: 'Why screens may disagree' },
            { value: 'purification', label: 'Purification angle', description: 'Income quality and purification implications' },
          ],
        },
      ],
    },
    {
      id: 'portfolio_audit',
      label: 'Portfolio Audit',
      description: 'Audit a portfolio or candidate basket for compliance and action points.',
      triggerKeywords: ['portfolio', 'audit', 'basket', 'holdings', 'allocation', 'positions'],
      autoTrigger: 'broad-only',
      executionHint:
        'Treat this as a portfolio-level audit. Screen each holding available, flag non-compliant or unresolved names, note concentration or methodology disagreement, and end with cleanup actions.',
      outputSections: [
        'Portfolio verdict',
        'Compliant vs non-compliant holdings',
        'Material risks',
        'Replacement or cleanup actions',
        'Open items',
      ],
      questions: [
        {
          id: 'holdings',
          title: 'Holdings',
          prompt: 'Which holdings or symbols should be audited?',
          kind: 'text',
          prefillFrom: 'query',
          placeholder: 'List symbols separated by commas, for example AAPL, MSFT, SPUS',
          summaryLabel: 'Holdings',
        },
        {
          id: 'portfolio_goal',
          title: 'Portfolio Goal',
          prompt: 'What kind of basket is this?',
          kind: 'single',
          defaultValue: 'existing_portfolio',
          summaryLabel: 'Portfolio goal',
          options: [
            { value: 'existing_portfolio', label: 'Existing portfolio', description: 'Audit a current live book' },
            { value: 'candidate_basket', label: 'Candidate basket', description: 'Review a proposed set before entry' },
            { value: 'etf_mix', label: 'ETF mix', description: 'Focus on ETF overlap and product fit' },
          ],
        },
        {
          id: 'risk_focus',
          title: 'Risk Focus',
          prompt: 'What risk angle matters most?',
          kind: 'single',
          defaultValue: 'weakest_links',
          summaryLabel: 'Risk focus',
          options: [
            { value: 'weakest_links', label: 'Weakest links', description: 'Find the main compliance problems first' },
            { value: 'concentration', label: 'Concentration', description: 'Look for exposure clustering and dependency' },
            { value: 'methodology_disagreement', label: 'Methodology disagreement', description: 'Show where verdicts may diverge' },
            { value: 'replacement_candidates', label: 'Replacement candidates', description: 'Surface likely swap-outs' },
          ],
        },
        {
          id: 'portfolio_constraints',
          title: 'Mandate Or Constraints',
          prompt: 'Any weighting, region, sector, or account constraints to respect?',
          kind: 'text',
          allowSkip: true,
          placeholder: 'Optional: weights, target regions, ETF-only, tax constraints, or broker limits',
          summaryLabel: 'Constraints',
        },
      ],
    },
    {
      id: 'purification_planner',
      label: 'Purification Planner',
      description: 'Estimate dividend purification needs and explain where confidence is weak.',
      triggerKeywords: ['purification', 'dividend', 'impure income', 'zakat', 'income quality'],
      autoTrigger: 'broad-only',
      executionHint:
        'Focus on purification-related data only. Separate authoritative figures from approximations, state missing inputs clearly, and avoid false precision when the backend has gaps.',
      outputSections: [
        'Purification summary',
        'Available authoritative data',
        'Estimated ranges or caveats',
        'What to track next',
      ],
      questions: [
        {
          id: 'income_holdings',
          title: 'Income Holdings',
          prompt: 'Which holdings need purification analysis?',
          kind: 'text',
          prefillFrom: 'query',
          placeholder: 'List symbols separated by commas',
          summaryLabel: 'Holdings',
        },
        {
          id: 'income_context',
          title: 'Income Context',
          prompt: 'What best describes the income situation?',
          kind: 'single',
          defaultValue: 'cash_income',
          summaryLabel: 'Income context',
          options: [
            { value: 'cash_income', label: 'Cash dividends received', description: 'Estimate what should be purified now' },
            { value: 'accumulating', label: 'Accumulating position', description: 'Focus on what to track over time' },
            { value: 'unknown', label: 'Unknown', description: 'Explain what inputs are still needed' },
          ],
        },
        {
          id: 'purification_goal',
          title: 'Purification Goal',
          prompt: 'What do you need from the analysis?',
          kind: 'single',
          defaultValue: 'estimate_now',
          summaryLabel: 'Purification goal',
          options: [
            { value: 'estimate_now', label: 'Estimate now', description: 'Give the best current purification read' },
            { value: 'track_over_time', label: 'Track over time', description: 'Set up a repeatable review approach' },
            { value: 'explain_method', label: 'Explain the method', description: 'Focus on how purification should be assessed' },
          ],
        },
        {
          id: 'amount_context',
          title: 'Amount Context',
          prompt: 'Do you want to include holding size or dividend amounts?',
          kind: 'text',
          allowSkip: true,
          placeholder: 'Optional: position size, annual dividend, or any cash amount already known',
          summaryLabel: 'Amount context',
        },
      ],
    },
    {
      id: 'watchlist_monitor',
      label: 'Watchlist Monitor',
      description: 'Monitor holdings or watchlists for drift, filings, earnings, and re-screen triggers.',
      triggerKeywords: ['monitor', 'watchlist', 'drift', 'earnings', 'filings', 'alerts'],
      autoTrigger: 'broad-only',
      executionHint:
        'Prioritize what changed since the last review: compliance drift, filings, earnings, major news, ETF composition changes, and catalysts that justify re-screening.',
      outputSections: [
        'What changed',
        'Compliance drift and re-screen triggers',
        'Priority names',
        'Next monitoring actions',
      ],
      questions: [
        {
          id: 'coverage_set',
          title: 'Coverage Set',
          prompt: 'Which watchlist, symbols, or holdings should be monitored?',
          kind: 'text',
          prefillFrom: 'query',
          placeholder: 'Watchlist id or symbols, for example wl_123 or MSFT, ASML, HLAL',
          summaryLabel: 'Coverage set',
        },
        {
          id: 'monitoring_window',
          title: 'Monitoring Window',
          prompt: 'What time horizon should the monitor focus on?',
          kind: 'single',
          defaultValue: 'near_term',
          summaryLabel: 'Monitoring window',
          options: [
            { value: 'near_term', label: 'Near term', description: 'What matters right now' },
            { value: 'this_earnings', label: 'This earnings cycle', description: 'Focus on the upcoming reporting window' },
            { value: 'quarterly', label: 'Quarterly review', description: 'Prepare a broader periodic checkpoint' },
          ],
        },
        {
          id: 'monitoring_focus',
          title: 'Monitoring Focus',
          prompt: 'Which signal type matters most?',
          kind: 'single',
          defaultValue: 'compliance_drift',
          summaryLabel: 'Monitoring focus',
          options: [
            { value: 'compliance_drift', label: 'Compliance drift', description: 'Lead with re-screen risk and Shariah changes' },
            { value: 'material_events', label: 'Material events', description: 'News, filings, and corporate actions' },
            { value: 'earnings_and_guidance', label: 'Earnings and guidance', description: 'Results, calls, and outlook shifts' },
            { value: 'watchlist_priorities', label: 'Watchlist priorities', description: 'Which names deserve attention first' },
          ],
        },
        {
          id: 'watchlist_context',
          title: 'Thesis Or Context',
          prompt: 'Any thesis, catalyst, or watchlist notes to keep in mind?',
          kind: 'text',
          allowSkip: true,
          placeholder: 'Optional: catalyst dates, thesis notes, portfolio role, or what changed recently',
          summaryLabel: 'Context',
        },
      ],
    },
    {
      id: 'replacement_ideas',
      label: 'Replacement Ideas',
      description: 'Find halal replacements, substitutes, or fresh screened ideas.',
      triggerKeywords: ['ideas', 'replace', 'replacement', 'alternative', 'substitute', 'swap'],
      autoTrigger: 'broad-only',
      executionHint:
        'Suggest only ideas that are screened or clearly marked for verification. Preserve the intended exposure when possible and explain trade-offs instead of giving generic stock picks.',
      outputSections: [
        'Target exposure',
        'Candidate replacements or ideas',
        'Why each fits',
        'Screening caveats',
        'Best next choice',
      ],
      questions: [
        {
          id: 'source_position',
          title: 'Source Position Or Theme',
          prompt: `What ${subjectLabel} or exposure are you trying to replace or explore?`,
          kind: 'text',
          prefillFrom: 'query',
          placeholder: 'Examples: replace QQQ, find halal semiconductor ETF, new AI ideas',
          summaryLabel: 'Source exposure',
        },
        {
          id: 'replacement_goal',
          title: 'Replacement Goal',
          prompt: 'What are you trying to accomplish?',
          kind: 'single',
          defaultValue: 'replace_non_compliant',
          summaryLabel: 'Replacement goal',
          options: [
            { value: 'replace_non_compliant', label: 'Replace a non-compliant holding', description: 'Find the cleanest halal substitute' },
            { value: 'find_halal_etf', label: 'Find a halal ETF', description: 'Prefer fund-based exposure' },
            { value: 'similar_exposure', label: 'Match a target exposure', description: 'Stay close to sector or style exposure' },
            { value: 'idea_generation', label: 'Fresh screened ideas', description: 'Generate new screened candidates' },
          ],
        },
        {
          id: 'exposure_target',
          title: 'Exposure Target',
          prompt: 'Which portfolio profile fits best?',
          kind: 'single',
          defaultValue: 'similar_exposure',
          summaryLabel: 'Exposure target',
          options: [
            { value: 'similar_exposure', label: 'Similar exposure', description: 'Stay close to the original risk and theme' },
            { value: 'lower_risk', label: 'Lower risk', description: 'Prefer more defensive substitutes' },
            { value: 'growth', label: 'Growth tilt', description: 'Keep upside potential in focus' },
            { value: 'income', label: 'Income tilt', description: 'Prefer dividend or cashflow orientation' },
            { value: 'diversified', label: 'More diversified', description: 'Reduce single-name or theme concentration' },
          ],
        },
        {
          id: 'hard_constraints',
          title: 'Hard Constraints',
          prompt: 'Any sector, geography, broker, or ETF-only constraints?',
          kind: 'text',
          allowSkip: true,
          placeholder: 'Optional: US-only, ETF-only, large cap, semiconductor exposure, exclude China',
          summaryLabel: 'Constraints',
        },
      ],
    },
  ];
}

function buildGuidedQaConfig(subjectLabel: string): ProfileGuidedQaConfig {
  return {
    enabled: true,
    workflows: buildGuidedQaWorkflows(subjectLabel),
  };
}

export const PROFILES: AppProfile[] = [
  {
    id: 'yassir-halal',
    assistantName: 'Yassir',
    brand: {
      id: 'yassir',
      name: 'Yassir',
      storageDir: '.agents/yassir',
      palette: basePalette,
      intro: {
        welcome: 'Welcome to Yassir',
        title: 'Your AI agent for deep financial research.',
        subtitle: 'Shariah screening, research, and portfolio intelligence.',
        logoAscii: yassirLogo,
      },
    },
    vertical: {
      id: 'halal-finance',
      label: 'Halal Finance',
      description: 'Shariah-aware financial research and portfolio workflows.',
      assistantDescription: 'a financial research assistant with access to live market and screening tools. All financial data and Shariah screening is powered by HalalTerminal API (https://api.halalterminal.com)',
      starterPrompts: {
        ready: [
          'Is MSFT halal under AAOIFI and MSCI?',
          'Screen SP500 and summarize compliant sectors.',
          'Compare HLAL, SPUS, and QQQ for Shariah compliance.',
          'Show my Halal Terminal usage and token costs.',
          'Calculate zakat on AAPL 25000 and MSFT 18000.',
          'Explain why ASML may differ by methodology.',
        ],
        setup: [
          'Explain AAOIFI screening thresholds in simple terms.',
          'What is dividend purification and when does it matter?',
          'Compare AAOIFI, DJIM, FTSE, MSCI, and S&P methodologies.',
          'Give me 5 example halal-investing prompts I can ask Yassir.',
          'How should I evaluate a stock for halal compliance step by step?',
          'Help me set up Halal Terminal and show what it unlocks.',
        ],
      },
      backend: {
        label: 'Halal Terminal',
        envVar: 'HALAL_TERMINAL_API_KEY',
        statusLabel: 'api.halalterminal.com',
        readyDescription: 'live screening available',
        missingDescription: 'use /keys to add HALAL_TERMINAL_API_KEY',
        doctorRecommendation:
          'Add `HALAL_TERMINAL_API_KEY` via `/keys` to unlock live Shariah screening, reports, watchlists, usage, and bulk scans.',
        runtimeSuggestionsBaseUrl: 'https://api.halalterminal.com',
        setup: {
          kind: 'generated-key-via-email',
          generateUrl: 'https://api.halalterminal.com/api/keys/generate',
          confirmTitle: 'Halal Terminal API (free)',
          confirmDescription:
            'Generate a free API key to enable Shariah compliance screening,\nzakat calculations, ETF analysis, and Islamic finance news.',
          confirmFooter:
            'No credit card required  ·  50 free tokens to start  ·  Enter to confirm · Esc to skip',
          emailTitle: 'Enter your email',
          emailDescription: 'A free API key will be sent and saved automatically.',
          emailFooter: 'Enter to confirm · Esc to skip',
          generatingMessage: 'Generating your API key...',
          successMessage: 'API key generated and saved to .env',
        },
      },
      enabledTools: [
        'get_financials',
        'get_market_data',
        'read_filings',
        'stock_screener',
        'web_fetch',
        'browser',
        'read_file',
        'write_file',
        'edit_file',
        'heartbeat',
        'memory_search',
        'memory_get',
        'memory_update',
        'web_search',
        'x_search',
        'get_shariah',
        'sec_company_facts',
        'sec_submissions',
        'skill',
      ],
      guidedQa: buildGuidedQaConfig('company, security, or portfolio idea'),
      features: {
        slashCommandFamilies: {
          shariah: true,
        },
        searchRanking: {
          providerWeights: { exa: 1.15, perplexity: 1.05, tavily: 1 },
          preferredDomains: [
            'sec.gov',
            'investor.apple.com',
            'investor.microsoft.com',
            'nasdaq.com',
            'nyse.com',
            'wsj.com',
            'reuters.com',
            'bloomberg.com',
            'ft.com',
          ],
          primaryDomains: ['sec.gov', 'investor.apple.com', 'investor.microsoft.com', 'nasdaq.com', 'nyse.com'],
          intentBoosts: [
            {
              keywords: ['10-k', '10q', '10-q', '8-k', 'filing', 'annual report', 'investor relations', 'earnings'],
              domains: ['sec.gov', 'investor.apple.com', 'investor.microsoft.com'],
              providers: { exa: 1 },
              boost: 12,
            },
            {
              keywords: ['halal', 'shariah', 'aaoifi', 'purification', 'zakat'],
              domains: ['sec.gov', 'reuters.com', 'bloomberg.com'],
              providers: { perplexity: 0.5 },
              boost: 6,
            },
          ],
        },
      },
      sourcePolicy: [
        'For company filings, reporting cadence, or official issuer disclosures, start with `sec_submissions`, `sec_company_facts`, `read_filings`, or `get_financials` before `web_search`',
        'For Shariah status and screening questions, prefer `get_shariah` first when available; use `web_search` afterward for commentary or supporting context',
      ],
      toolUsagePolicy: [
        'For stock quotes, OHLC history, company news, and trending assets, use get_market_data',
        'For HalalTerminal asset profiles, database records, dividend history, and SEC XBRL facts, use get_financials',
        'For asset discovery by ticker, name, sector, country, exchange, or asset type, use stock_screener',
        'Do not claim analyst estimates, insider trades, crypto prices, segmented revenues, or numeric metric screening unless a tool result provides them',
        'Call get_financials or get_market_data ONCE with the full natural language query - they handle multi-company/multi-metric requests internally',
        'Do NOT break up queries into multiple tool calls when one call can handle the request',
      ],
    },
  },
];

export const DEFAULT_PROFILE_ID = 'yassir-halal';

// ============================================================================
// External (Crafted) Profile Loading
// ============================================================================

const EXTERNAL_PROFILES_DIR = join('.agents', 'profiles');

/**
 * Load crafted profiles from .agents/profiles/{id}/profile.json.
 * Each JSON file is validated against the Zod schema before acceptance.
 * Malformed profiles are skipped with a warning.
 */
function loadExternalProfiles(): AppProfile[] {
  if (!existsSync(EXTERNAL_PROFILES_DIR)) return [];

  const profiles: AppProfile[] = [];
  let entries: string[];
  try {
    entries = readdirSync(EXTERNAL_PROFILES_DIR);
  } catch {
    return [];
  }

  for (const name of entries) {
    const entryPath = join(EXTERNAL_PROFILES_DIR, name);
    try { if (!statSync(entryPath).isDirectory()) continue; } catch { continue; }
    const jsonPath = join(EXTERNAL_PROFILES_DIR, name, 'profile.json');
    if (!existsSync(jsonPath)) continue;

    try {
      // Lazy import to avoid circular dependency at module init time
      const { appProfileSchema } = require('./schema.js');
      const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
      const parsed = appProfileSchema.parse(raw);
      profiles.push(parsed as AppProfile);
    } catch (err) {
      logger.warn(`Skipping malformed profile at ${jsonPath}: ${err}`);
    }
  }
  return profiles;
}

/** Merged list of builtin + external profiles. External overrides builtin by ID. */
let mergedProfiles: AppProfile[] | null = null;

function getMergedProfiles(): AppProfile[] {
  if (mergedProfiles) return mergedProfiles;

  const external = loadExternalProfiles();
  const externalIds = new Set(external.map(p => p.id));

  // Builtin profiles, excluding any overridden by external
  mergedProfiles = [
    ...PROFILES.filter(p => !externalIds.has(p.id)),
    ...external,
  ];
  return mergedProfiles;
}

/** Clear the merged profile cache (e.g. after crafting a new profile). */
export function clearProfileCache(): void {
  mergedProfiles = null;
}

export function getProfileById(profileId: string): AppProfile | undefined {
  return getMergedProfiles().find((profile) => profile.id === profileId);
}

export function listAllProfiles(): AppProfile[] {
  return getMergedProfiles();
}
