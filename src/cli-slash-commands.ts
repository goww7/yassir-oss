import type { SlashCommand } from '@mariozechner/pi-tui';
import type { RuntimeIndexSuggestion, RuntimeWatchlistSuggestion } from './cli-runtime-suggestions.js';
import { getCurrentProfile } from './profile/current.js';
import {
  createWorkspace,
  formatWorkspaceSummary,
  getActiveWorkspace,
  listWorkspaces,
  setActiveWorkspaceId,
} from './workspace/manager.js';

const DEFAULT_RECENT_SYMBOLS = ['MSFT', 'AAPL', 'GOOGL', 'ASML', 'NVDA', 'QQQ'];
const COMMON_NON_SYMBOLS = new Set([
  'A',
  'AI',
  'API',
  'AND',
  'ETF',
  'ETFS',
  'FOR',
  'GET',
  'HALAL',
  'HELP',
  'LIST',
  'MY',
  'OR',
  'SHOW',
  'THE',
  'USE',
]);
function toAutocompleteItems(values: readonly string[], description: string) {
  return values.map((value) => ({ value, label: value, description }));
}

function buildSymbolCompletions(
  argumentPrefix: string,
  recentSymbols: readonly string[],
  description: string,
  maxItems = 8,
) {
  const endsWithSpace = /\s$/.test(argumentPrefix);
  const tokens = argumentPrefix.trim().split(/\s+/).filter(Boolean);
  const committed = endsWithSpace ? tokens : tokens.slice(0, -1);
  const partial = endsWithSpace ? '' : (tokens.at(-1) ?? '').toUpperCase();
  const used = new Set(committed.map((token) => token.toUpperCase()));

  return recentSymbols
    .filter((symbol) => !used.has(symbol.toUpperCase()))
    .filter((symbol) => !partial || symbol.startsWith(partial))
    .slice(0, maxItems)
    .map((symbol) => {
      const value = [...committed, symbol].join(' ');
      return { value, label: value, description };
    });
}

function buildWatchlistIdCompletions(
  subcommand: string,
  idPrefix: string,
  watchlists: readonly RuntimeWatchlistSuggestion[],
  maxItems = 8,
) {
  const normalizedPrefix = idPrefix.toLowerCase();
  return watchlists
    .filter(
      (watchlist) =>
        watchlist.id.toLowerCase().startsWith(normalizedPrefix) ||
        watchlist.name.toLowerCase().includes(normalizedPrefix),
    )
    .slice(0, maxItems)
    .map((watchlist) => ({
      value: `${subcommand} ${watchlist.id}`,
      label: `${watchlist.id} · ${watchlist.name}`,
      description:
        watchlist.count !== undefined
          ? `${watchlist.count} symbol${watchlist.count === 1 ? '' : 's'}`
          : 'Watchlist',
    }));
}

export function extractRecentSymbols(messages: readonly string[]): string[] {
  const seen = new Set<string>();
  const symbols: string[] = [];

  for (const message of [...messages].reverse()) {
    const matches = message.match(/\b[A-Z][A-Z0-9.-]{0,4}\b/g) ?? [];
    for (const match of matches) {
      const symbol = match.toUpperCase();
      if (COMMON_NON_SYMBOLS.has(symbol)) continue;
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      symbols.push(symbol);
      if (symbols.length >= 8) {
        return symbols;
      }
    }
  }

  for (const fallback of DEFAULT_RECENT_SYMBOLS) {
    if (!seen.has(fallback)) {
      symbols.push(fallback);
    }
    if (symbols.length >= 8) break;
  }

  return symbols;
}

export function createSlashCommands(options: {
  getRecentSymbols: () => string[];
  getBulkIndices: () => RuntimeIndexSuggestion[];
  getWatchlists: () => RuntimeWatchlistSuggestion[];
}): SlashCommand[] {
  const currentProfile = getCurrentProfile();
  const commands: SlashCommand[] = [
    { name: 'model', description: 'Change the active model' },
    { name: 'workspace', description: 'Create, select, or inspect a portfolio research room' },
    { name: 'attach', description: 'Import a local file into the active workspace inputs folder' },
    { name: 'settings', description: 'Open setup actions' },
    { name: 'keys', description: 'Add or update API keys' },
    { name: 'guide', description: 'Open a guided Shariah investment workflow' },
    { name: 'help', description: 'Show the command list' },
    { name: 'doctor', description: 'Run a local readiness check' },
  ];

  if (currentProfile.vertical.features.slashCommandFamilies.shariah) {
    commands.push(
      { name: 'usage', description: 'Show backend usage and quota risk' },
      {
        name: 'screen',
        description: 'Run a full Shariah screen for a symbol',
        getArgumentCompletions(argumentPrefix) {
          if (argumentPrefix.includes(' ')) return null;
          return toAutocompleteItems(
            options.getRecentSymbols().filter((symbol) => symbol.startsWith(argumentPrefix.toUpperCase())),
            'Recent symbol',
          );
        },
      },
      {
        name: 'compare',
        description: 'Compare 2 to 5 symbols side by side',
        getArgumentCompletions(argumentPrefix) {
          const items = buildSymbolCompletions(argumentPrefix, options.getRecentSymbols(), 'Recent symbol');
          return items.length ? items : null;
        },
      },
      {
        name: 'portfolio',
        description: 'Scan a portfolio and summarize compliance',
        getArgumentCompletions(argumentPrefix) {
          const items = buildSymbolCompletions(argumentPrefix, options.getRecentSymbols(), 'Recent symbol');
          return items.length ? items : null;
        },
      },
      {
        name: 'audit',
        description: 'Run a full portfolio compliance audit',
        getArgumentCompletions(argumentPrefix) {
          const items = buildSymbolCompletions(argumentPrefix, options.getRecentSymbols(), 'Recent symbol');
          return items.length ? items : null;
        },
      },
      {
        name: 'purification',
        description: 'Estimate dividend purification for one or more holdings',
        getArgumentCompletions(argumentPrefix) {
          const items = buildSymbolCompletions(argumentPrefix, options.getRecentSymbols(), 'Recent symbol');
          return items.length ? items : null;
        },
      },
      {
        name: 'bulk',
        description: 'Run a bulk index screen like SP500 or DJIA',
        getArgumentCompletions(argumentPrefix) {
          if (argumentPrefix.includes(' ')) return null;
          const items = options
            .getBulkIndices()
            .filter((index) => index.name.startsWith(argumentPrefix.toUpperCase()))
            .map((index) => ({
              value: index.name,
              label: index.name,
              description: index.description || 'Live bulk index',
            }));
          return items.length ? items : null;
        },
      },
      {
        name: 'report',
        description: 'Generate a full screening report',
        getArgumentCompletions(argumentPrefix) {
          if (argumentPrefix.includes(' ')) return null;
          return toAutocompleteItems(
            options.getRecentSymbols().filter((symbol) => symbol.startsWith(argumentPrefix.toUpperCase())),
            'Recent symbol',
          );
        },
      },
      {
        name: 'brief',
        description: 'Generate a concise Shariah investment brief',
        getArgumentCompletions(argumentPrefix) {
          if (argumentPrefix.includes(' ')) return null;
          return toAutocompleteItems(
            options.getRecentSymbols().filter((symbol) => symbol.startsWith(argumentPrefix.toUpperCase())),
            'Recent symbol',
          );
        },
      },
      {
        name: 'monitor',
        description: 'Review holdings or watchlists for compliance drift and events',
        getArgumentCompletions(argumentPrefix) {
          if (argumentPrefix.includes(' ')) return null;
          return toAutocompleteItems(
            options.getRecentSymbols().filter((symbol) => symbol.startsWith(argumentPrefix.toUpperCase())),
            'Recent symbol',
          );
        },
      },
      {
        name: 'ideas',
        description: 'Suggest halal replacements or fresh Shariah ideas',
        getArgumentCompletions(argumentPrefix) {
          if (argumentPrefix.includes(' ')) return null;
          return toAutocompleteItems(
            options.getRecentSymbols().filter((symbol) => symbol.startsWith(argumentPrefix.toUpperCase())),
            'Recent symbol',
          );
        },
      },
      {
        name: 'cache',
        description: 'Use cached-first lookup for a symbol or ETF',
        getArgumentCompletions(argumentPrefix) {
          if (argumentPrefix.includes(' ')) return null;
          return toAutocompleteItems(
            options.getRecentSymbols().filter((symbol) => symbol.startsWith(argumentPrefix.toUpperCase())),
            'Recent symbol',
          );
        },
      },
      {
        name: 'watchlist',
        description: 'List, create, update, or delete watchlists',
        getArgumentCompletions(argumentPrefix) {
          const trimmed = argumentPrefix.trimStart();
          if (!trimmed.includes(' ')) {
            return toAutocompleteItems(
              ['list', 'create', 'show', 'add', 'remove', 'delete'].filter((action) =>
                action.startsWith(trimmed.toLowerCase()),
              ),
              'Watchlist action',
            );
          }

          const tokens = trimmed.split(/\s+/).filter(Boolean);
          const [subcommand = ''] = tokens;
          const endsWithSpace = /\s$/.test(argumentPrefix);

          if (['show', 'add', 'remove', 'delete'].includes(subcommand)) {
            if (tokens.length === 1 || (tokens.length === 2 && !endsWithSpace)) {
              const idPrefix = tokens.length === 1 ? '' : tokens[1] ?? '';
              const items = buildWatchlistIdCompletions(subcommand, idPrefix, options.getWatchlists());
              return items.length ? items : null;
            }

            if (['add', 'remove'].includes(subcommand)) {
              const watchlistId = tokens[1];
              const remainingPrefix = endsWithSpace ? '' : (tokens.at(-1) ?? '');
              const committedSymbols =
                endsWithSpace ? tokens.slice(2) : tokens.slice(2, -1);
              const items = buildSymbolCompletions(
                [watchlistId, ...committedSymbols, remainingPrefix].filter(Boolean).slice(1).join(' '),
                options.getRecentSymbols(),
                'Recent symbol',
              ).map((item) => ({
                ...item,
                value: `${subcommand} ${watchlistId} ${item.value}`.trim(),
                label: `${subcommand} ${watchlistId} ${item.label}`.trim(),
              }));
              return items.length ? items : null;
            }
          }

          return null;
        },
      },
    );
  }

  return commands;
}

export interface SlashCommandContext {
  model: string;
  provider: string;
  providerLabel: string;
  hasHalalBackend: boolean;
  configuredServices: ReadonlyArray<{ label: string; configured: boolean }>;
}

export type SlashCommandAction =
  | { kind: 'passthrough' }
  | { kind: 'insert'; text: string }
  | { kind: 'run'; query: string }
  | { kind: 'attach'; path?: string }
  | { kind: 'guide'; workflowId?: string; seedQuery?: string }
  | { kind: 'local'; answer: string };

const PRODUCT_LOCKED_TEXT = [
  'Yassir now runs as a single-purpose Shariah investing product.',
  '',
  'Profiles and craft workflows are no longer part of the main product surface.',
].join('\n');

function splitSymbols(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function formatStatus(ok: boolean): string {
  return ok ? 'configured' : 'missing';
}

function buildHelpText(): string {
  const currentProfile = getCurrentProfile();
  const lines = [
    'Available slash commands',
    '',
    '/model  Change the active model',
    '/workspace  Create, select, or inspect a portfolio research room',
    '/attach [path]  Import a local file into the active workspace',
    '/settings  Open setup actions',
    '/keys  Add or update API keys',
    '/guide  Open a guided Shariah investment workflow',
    '/help  Show this command list',
    '/doctor  Run a local readiness check',
    '',
    'Shortcuts',
    '/1 to /6 insert starter prompts from the intro screen.',
    '',
    'Workspace',
    '/workspace status',
    '/workspace list',
    '/workspace new <name>',
    '/workspace use <id>',
    '/attach',
    '/attach /absolute/path/to/file.pdf',
  ];

  if (currentProfile.vertical.features.slashCommandFamilies.shariah) {
    lines.splice(
      6,
      0,
      '/usage  Show backend usage, plan, and quota risk',
      '/screen <symbol>  Run a full Shariah screen (`/screen` opens the review workflow)',
      '/compare <a> <b> [c d e]  Compare 2 to 5 symbols',
      '/portfolio <symbols...>  Scan a portfolio and summarize compliance',
      '/audit <symbols...>  Run a portfolio audit with risks and action points (`/audit` opens the audit workflow)',
      '/purification <symbols...>  Estimate purification and income-quality implications (`/purification` opens the workflow)',
      '/bulk <index> [limit]  Run a bulk index screen like SP500 or DJIA',
      '/report <symbol>  Generate a full screening report',
      '/brief <symbol>  Generate a concise Shariah investment brief',
      '/monitor <watchlist|symbols...>  Review holdings for drift, filings, and catalysts (`/monitor` opens the workflow)',
      '/ideas <symbol|theme>  Suggest halal replacements or fresh ideas (`/ideas` opens the workflow)',
      '/cache <symbol>  Use cached-first lookup for a symbol or ETF',
      '/watchlist list',
      '/watchlist create <name>: <symbols...>',
      '/watchlist show <id>',
      '/watchlist add <id> <symbol>',
      '/watchlist remove <id> <symbol>',
      '/watchlist delete <id>',
    );
  }

  return lines.join('\n');
}

function buildDoctorText(context: SlashCommandContext): string {
  const currentProfile = getCurrentProfile();
  const activeWorkspace = getActiveWorkspace();
  const serviceLines = context.configuredServices.map(
    (service) => `- ${service.label}: ${formatStatus(service.configured)}`,
  );

  const recommendations: string[] = [];
  if (currentProfile.vertical.backend && !context.hasHalalBackend) {
    recommendations.push(currentProfile.vertical.backend.doctorRecommendation);
  }
  if (!context.configuredServices.some((service) => service.label === 'Search' && service.configured)) {
    recommendations.push('Add one search provider key (`BRAVE_SEARCH_API_KEY`, `EXASEARCH_API_KEY`, `PERPLEXITY_API_KEY`, or `TAVILY_API_KEY`) for richer web research.');
  }
  if (!recommendations.length) {
    recommendations.push(
      currentProfile.vertical.features.slashCommandFamilies.shariah
        ? 'Core Shariah investing stack looks ready. Use `/screen`, `/audit`, `/purification`, `/monitor`, and `/watchlist` to exercise the backend more deeply.'
        : 'Core research stack looks ready. Use `/workspace`, `/attach`, `/guide`, and live research prompts to exercise the workflow more deeply.',
    );
  }

  return [
    'System readiness',
    '',
    `- Product: ${currentProfile.assistantName}`,
    `- Focus: ${currentProfile.vertical.label}`,
    `- Provider: ${context.providerLabel} (${context.provider})`,
    `- Model: ${context.model}`,
    `- Active workspace: ${activeWorkspace ? `${activeWorkspace.name} (${activeWorkspace.id})` : 'none'}`,
    ...(currentProfile.vertical.backend
      ? [`- ${currentProfile.vertical.backend.label}: ${formatStatus(context.hasHalalBackend)}`]
      : []),
    ...serviceLines,
    '',
    'Recommended next steps',
    ...recommendations.map((item) => `- ${item}`),
  ].join('\n');
}

function buildBackendMissingText(command: string): string {
  const currentProfile = getCurrentProfile();
  const backend = currentProfile.vertical.backend;
  return [
    `\`${command}\` needs \`${backend?.envVar ?? 'the configured backend'}\`.`,
    '',
    'Use `/keys` to configure the backend first.',
  ].join('\n');
}

function buildWorkspaceText(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    const activeWorkspace = getActiveWorkspace();
    return [
      'Portfolio room commands',
      activeWorkspace ? `Active: ${activeWorkspace.name} (${activeWorkspace.id})` : 'Active: none',
      '',
      '/workspace status',
      '/workspace list',
      '/workspace new <name>',
      '/workspace use <id>',
      '/attach [path]',
    ].join('\n');
  }

  if (trimmed === 'status') {
    const activeWorkspace = getActiveWorkspace();
    if (!activeWorkspace) {
      return [
        'No active workspace.',
        '',
        'Use `/workspace new <name>` to create one for a portfolio, watchlist, or research topic.',
        'Use `/workspace list` to inspect existing workspaces.',
      ].join('\n');
    }
    return formatWorkspaceSummary(activeWorkspace);
  }

  if (trimmed === 'list') {
    const workspaces = listWorkspaces();
    if (!workspaces.length) {
      return 'No workspaces yet. Use `/workspace new <name>` to create your first portfolio room.';
    }
    return [
      'Available workspaces',
      '',
      ...workspaces.map((workspace) => `- ${workspace.name} (${workspace.id})`),
    ].join('\n');
  }

  if (trimmed.startsWith('new ')) {
    const name = trimmed.slice(4).trim();
    if (!name) {
      return 'Use `/workspace new <name>`.';
    }
    const workspace = createWorkspace(name);
    setActiveWorkspaceId(workspace.id);
    return [
      `Workspace created and activated: ${workspace.name} (${workspace.id})`,
      '',
      formatWorkspaceSummary(workspace),
      '',
      'Drop holdings exports, notes, filings, or ETF material into the `inputs` folder, then ask the agent to inspect the workspace.',
    ].join('\n');
  }

  if (trimmed.startsWith('use ')) {
    const workspaceId = trimmed.slice(4).trim();
    if (!workspaceId) {
      return 'Use `/workspace use <id>`.';
    }
    const workspace = listWorkspaces().find((item) => item.id === workspaceId);
    if (!workspace) {
      return `Workspace not found: ${workspaceId}`;
    }
    setActiveWorkspaceId(workspaceId);
    return `Active workspace set to ${workspace.name} (${workspace.id})\n\n${formatWorkspaceSummary(workspace)}`;
  }

  return [
    'Portfolio room commands',
    '',
    '/workspace status',
    '/workspace list',
    '/workspace new <name>',
    '/workspace use <id>',
  ].join('\n');
}

function resolveGuideShortcut(rest: string): SlashCommandAction {
  if (!rest) {
    return { kind: 'guide' };
  }

  const [firstToken = '', ...remainingTokens] = rest.split(/\s+/);
  const seedQuery = remainingTokens.join(' ').trim() || undefined;
  switch (firstToken.toLowerCase()) {
    case 'screen':
    case 'review':
    case 'brief':
      return { kind: 'guide', workflowId: 'single_asset_review', seedQuery };
    case 'portfolio':
    case 'audit':
      return { kind: 'guide', workflowId: 'portfolio_audit', seedQuery };
    case 'purification':
      return { kind: 'guide', workflowId: 'purification_planner', seedQuery };
    case 'monitor':
      return { kind: 'guide', workflowId: 'watchlist_monitor', seedQuery };
    case 'ideas':
    case 'replace':
      return { kind: 'guide', workflowId: 'replacement_ideas', seedQuery };
    default:
      return { kind: 'guide', seedQuery: rest };
  }
}

export function resolveSlashCommand(
  input: string,
  context: SlashCommandContext,
): SlashCommandAction {
  if (!input.startsWith('/')) {
    return { kind: 'passthrough' };
  }

  const trimmed = input.trim();
  const firstSpace = trimmed.indexOf(' ');
  const command = trimmed.slice(1, firstSpace === -1 ? undefined : firstSpace).toLowerCase();
  const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();

  switch (command) {
    case 'profile':
    case 'craft':
    case 'benchmark':
    case 'diligence':
    case 'strategy':
      return { kind: 'local', answer: PRODUCT_LOCKED_TEXT };
    case 'guide':
      return resolveGuideShortcut(rest);
    case 'help':
      return { kind: 'local', answer: buildHelpText() };
    case 'doctor':
      return { kind: 'local', answer: buildDoctorText(context) };
    case 'workspace':
      return { kind: 'local', answer: buildWorkspaceText(rest) };
    case 'attach':
      return { kind: 'attach', path: rest || undefined };
    case 'screen':
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/screen') };
      if (!rest) return { kind: 'guide', workflowId: 'single_asset_review' };
      return {
        kind: 'run',
        query: `Run a full Shariah compliance screen for ${rest.toUpperCase()}. Give me the overall verdict, methodology breakdown, key reasons, purification rate if available, and any data quality caveats.`,
      };
    case 'compare': {
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/compare') };
      const symbols = splitSymbols(rest);
      if (symbols.length < 2) return { kind: 'insert', text: '/compare MSFT AAPL ASML' };
      if (symbols.length > 5) {
        return { kind: 'local', answer: 'Use `/compare` with 2 to 5 symbols.' };
      }
      return {
        kind: 'run',
        query: `Compare ${symbols.join(', ')} for Shariah compliance, methodology differences, valuation style, and key risks. End with the best fit for a halal watchlist.`,
      };
    }
    case 'portfolio': {
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/portfolio') };
      const symbols = splitSymbols(rest);
      if (!symbols.length) return { kind: 'guide', workflowId: 'portfolio_audit' };
      return {
        kind: 'run',
        query: `Run a portfolio Shariah scan for ${symbols.join(', ')}. Summarize compliant vs non-compliant names, unresolved symbols, methodology caveats, and the biggest portfolio risks.`,
      };
    }
    case 'audit': {
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/audit') };
      const symbols = splitSymbols(rest);
      if (!symbols.length) return { kind: 'guide', workflowId: 'portfolio_audit' };
      return {
        kind: 'run',
        query: `Run a full Shariah investment audit for ${symbols.join(', ')}. Include compliance status, methodology disagreement, concentration risks, unresolved names, portfolio weak points, and clear next actions.`,
      };
    }
    case 'purification': {
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/purification') };
      const symbols = splitSymbols(rest);
      if (!symbols.length) return { kind: 'guide', workflowId: 'purification_planner' };
      return {
        kind: 'run',
        query: `Estimate dividend purification implications for ${symbols.join(', ')}. Use authoritative backend data first, explain what is available vs missing, and tell me where purification guidance is still uncertain.`,
      };
    }
    case 'watchlist': {
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/watchlist') };
      if (!rest) return { kind: 'insert', text: '/watchlist create Halal Tech: AAPL MSFT GOOGL' };

      const [subcommand = '', ...restTokens] = rest.split(/\s+/);
      const payload = restTokens.join(' ').trim();
      switch (subcommand.toLowerCase()) {
        case 'list':
          return {
            kind: 'run',
            query: 'List my watchlists and summarize what each one contains.',
          };
        case 'create': {
          const [namePart, symbolPart = ''] = payload.split(':');
          const name = namePart?.trim();
          if (!name) return { kind: 'insert', text: '/watchlist create Halal Tech: AAPL MSFT GOOGL' };
          const symbols = splitSymbols(symbolPart);
          return {
            kind: 'run',
            query: `Create a watchlist named "${name}"${symbols.length ? ` with symbols ${symbols.join(', ')}` : ''}. Return the watchlist id and final contents.`,
          };
        }
        case 'show':
        case 'get':
          if (!payload) return { kind: 'insert', text: '/watchlist show wl_example123' };
          return {
            kind: 'run',
            query: `Get watchlist ${payload} and summarize its contents.`,
          };
        case 'delete':
          if (!payload) return { kind: 'insert', text: '/watchlist delete wl_example123' };
          return {
            kind: 'run',
            query: `Delete watchlist ${payload}. Confirm the deletion result.`,
          };
        case 'add': {
          const [watchlistId, symbol] = payload.split(/\s+/);
          if (!watchlistId || !symbol) return { kind: 'insert', text: '/watchlist add wl_example123 MSFT' };
          return {
            kind: 'run',
            query: `Add ${symbol.toUpperCase()} to watchlist ${watchlistId}. Return the updated watchlist.`,
          };
        }
        case 'remove': {
          const [watchlistId, symbol] = payload.split(/\s+/);
          if (!watchlistId || !symbol) return { kind: 'insert', text: '/watchlist remove wl_example123 MSFT' };
          return {
            kind: 'run',
            query: `Remove ${symbol.toUpperCase()} from watchlist ${watchlistId}. Return the updated watchlist.`,
          };
        }
        default:
          return {
            kind: 'run',
            query: `Help me manage my watchlists. User request: ${rest}`,
          };
      }
    }
    case 'usage':
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/usage') };
      return {
        kind: 'run',
        query: `Show my Halal Terminal API usage, current plan, token costs, daily usage, and recent requests${rest ? ` with focus on ${rest}` : ''}. Highlight quota risk and the cheapest next actions.`,
      };
    case 'bulk':
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/bulk') };
      if (!rest) return { kind: 'insert', text: '/bulk SP500' };
      return {
        kind: 'run',
        query: `Run a bulk Shariah screen for ${rest}. Use quota-aware, cached-first routing when possible. Summarize status, methodology breakdown, sector insights, and any backend limitations.`,
      };
    case 'report':
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/report') };
      if (!rest) return { kind: 'insert', text: '/report MSFT' };
      return {
        kind: 'run',
        query: `Generate a professional Shariah screening report for ${rest.toUpperCase()}. Include business screen, financial ratios, methodology verdicts, purification, and major risks.`,
      };
    case 'brief':
      if (!context.hasHalalBackend) {
        return { kind: 'guide', workflowId: 'single_asset_review', seedQuery: rest || undefined };
      }
      if (!rest) return { kind: 'guide', workflowId: 'single_asset_review' };
      return {
        kind: 'run',
        query: `Give me an institutional brief on ${rest.toUpperCase()}. Include Shariah status, business summary, methodology differences, valuation style, key risks, and next checks.`,
      };
    case 'monitor':
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/monitor') };
      if (!rest) return { kind: 'guide', workflowId: 'watchlist_monitor' };
      return {
        kind: 'run',
        query: `Monitor ${rest}. Prioritize Shariah compliance drift, watchlist relevance, filings, earnings, and material events. Highlight what changed, what matters now for halal investors, and what should be re-screened.`,
      };
    case 'ideas':
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/ideas') };
      if (!rest) return { kind: 'guide', workflowId: 'replacement_ideas' };
      return {
        kind: 'run',
        query: `Generate halal investing ideas for: ${rest}. Prefer Shariah-compliant stocks and ETFs, explain why they fit, and include screening or methodology caveats before suggesting them.`,
      };
    case 'cache':
      if (!context.hasHalalBackend) return { kind: 'local', answer: buildBackendMissingText('/cache') };
      if (!rest) return { kind: 'insert', text: '/cache MSFT' };
      return {
        kind: 'run',
        query: `Use cached-first routing for ${rest.toUpperCase()}. Prefer cached screening, ETF, and database results without forcing a refresh. Summarize what is available, freshness clues, and any gaps.`,
      };
    default:
      return { kind: 'passthrough' };
  }
}
