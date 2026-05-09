import { describe, expect, test } from 'bun:test';
import { createSlashCommands, extractRecentSymbols, resolveSlashCommand } from './cli-slash-commands.js';

const readyContext = {
  model: 'gpt-5',
  provider: 'openai',
  providerLabel: 'OpenAI',
  hasHalalBackend: true,
  configuredServices: [
    { label: 'Current provider key', configured: true },
    { label: 'Search', configured: true },
    { label: 'X / Twitter', configured: false },
  ],
} as const;

describe('resolveSlashCommand', () => {
  test('builds a screen query', () => {
    const result = resolveSlashCommand('/screen msft', readyContext);

    expect(result).toEqual({
      kind: 'run',
      query:
        'Run a full Shariah compliance screen for MSFT. Give me the overall verdict, methodology breakdown, key reasons, purification rate if available, and any data quality caveats.',
    });
  });

  test('returns a template when compare symbols are missing', () => {
    const result = resolveSlashCommand('/compare', readyContext);

    expect(result).toEqual({ kind: 'insert', text: '/compare MSFT AAPL ASML' });
  });

  test('renders local help', () => {
    const result = resolveSlashCommand('/help', readyContext);

    expect(result.kind).toBe('local');
    if (result.kind === 'local') {
      expect(result.answer).toContain('/screen <symbol>');
      expect(result.answer).toContain('/guide');
      expect(result.answer).toContain('/doctor');
    }
  });

  test('opens the single-asset workflow when /screen has no symbol', () => {
    const result = resolveSlashCommand('/screen', readyContext);

    expect(result).toEqual({
      kind: 'guide',
      workflowId: 'single_asset_review',
    });
  });

  test('blocks backend commands when halal backend is missing', () => {
    const result = resolveSlashCommand('/usage', {
      ...readyContext,
      hasHalalBackend: false,
    });

    expect(result).toEqual({
      kind: 'local',
      answer: '`/usage` needs `HALAL_TERMINAL_API_KEY`.\n\nUse `/keys` to configure the backend first.',
    });
  });

  test('parses watchlist create syntax', () => {
    const result = resolveSlashCommand('/watchlist create Halal Tech: AAPL MSFT', readyContext);

    expect(result).toEqual({
      kind: 'run',
      query:
        'Create a watchlist named "Halal Tech" with symbols AAPL, MSFT. Return the watchlist id and final contents.',
    });
  });
});

describe('extractRecentSymbols', () => {
  test('extracts recent uppercase ticker-like symbols and preserves recency', () => {
    const symbols = extractRecentSymbols([
      'compare AAPL MSFT',
      'is ASML halal?',
      '/portfolio NVDA GOOGL',
    ]);

    expect(symbols.slice(0, 5)).toEqual(['NVDA', 'GOOGL', 'ASML', 'AAPL', 'MSFT']);
  });

  test('falls back to defaults when history has no symbols', () => {
    const symbols = extractRecentSymbols(['tell me about halal investing']);

    expect(symbols[0]).toBe('MSFT');
    expect(symbols).toContain('AAPL');
  });
});

describe('createSlashCommands', () => {
  test('adds index completions for bulk', () => {
    const bulk = createSlashCommands({
      getRecentSymbols: () => ['MSFT'],
      getBulkIndices: () => [
        { name: 'SP500', description: 'S&P 500' },
        { name: 'DJIA', description: 'Dow Jones' },
      ],
      getWatchlists: () => [],
    }).find((command) => command.name === 'bulk');

    expect(bulk?.getArgumentCompletions?.('SP')).toEqual([
      { value: 'SP500', label: 'SP500', description: 'S&P 500' },
    ]);
  });

  test('adds recent symbol completions for screen', () => {
    const screen = createSlashCommands({
      getRecentSymbols: () => ['MSFT', 'ASML'],
      getBulkIndices: () => [],
      getWatchlists: () => [],
    }).find(
      (command) => command.name === 'screen',
    );

    expect(screen?.getArgumentCompletions?.('A')).toEqual([
      { value: 'ASML', label: 'ASML', description: 'Recent symbol' },
    ]);
  });

  test('adds action completions for watchlist', () => {
    const watchlist = createSlashCommands({
      getRecentSymbols: () => ['MSFT'],
      getBulkIndices: () => [],
      getWatchlists: () => [{ id: 'wl_123', name: 'Halal Tech', count: 3 }],
    }).find(
      (command) => command.name === 'watchlist',
    );

    expect(watchlist?.getArgumentCompletions?.('cr')).toEqual([
      { value: 'create', label: 'create', description: 'Watchlist action' },
    ]);
  });

  test('adds live watchlist id completions for watchlist show', () => {
    const watchlist = createSlashCommands({
      getRecentSymbols: () => ['MSFT'],
      getBulkIndices: () => [],
      getWatchlists: () => [{ id: 'wl_123', name: 'Halal Tech', count: 3 }],
    }).find((command) => command.name === 'watchlist');

    expect(watchlist?.getArgumentCompletions?.('show wl')).toEqual([
      { value: 'show wl_123', label: 'wl_123 · Halal Tech', description: '3 symbols' },
    ]);
  });

  test('adds recent symbols for compare and portfolio', () => {
    const commands = createSlashCommands({
      getRecentSymbols: () => ['MSFT', 'ASML', 'NVDA'],
      getBulkIndices: () => [],
      getWatchlists: () => [],
    });
    const compare = commands.find((command) => command.name === 'compare');
    const portfolio = commands.find((command) => command.name === 'portfolio');

    expect(compare?.getArgumentCompletions?.('MSFT A')).toEqual([
      { value: 'MSFT ASML', label: 'MSFT ASML', description: 'Recent symbol' },
    ]);
    expect(portfolio?.getArgumentCompletions?.('A')).toEqual([
      { value: 'ASML', label: 'ASML', description: 'Recent symbol' },
    ]);
  });

  test('includes guided workflow commands', () => {
    const commands = createSlashCommands({
      getRecentSymbols: () => ['MSFT'],
      getBulkIndices: () => [],
      getWatchlists: () => [],
    });

    expect(commands.some((command) => command.name === 'guide')).toBe(true);
    expect(commands.some((command) => command.name === 'audit')).toBe(true);
    expect(commands.some((command) => command.name === 'purification')).toBe(true);
    expect(commands.some((command) => command.name === 'monitor')).toBe(true);
    expect(commands.some((command) => command.name === 'ideas')).toBe(true);
  });

  test('includes predictive-compliance commands', () => {
    const commands = createSlashCommands({
      getRecentSymbols: () => ['MSFT'],
      getBulkIndices: () => [],
      getWatchlists: () => [],
    });

    expect(commands.some((command) => command.name === 'trajectory')).toBe(true);
    expect(commands.some((command) => command.name === 'staleness')).toBe(true);
  });

  test('autocompletes recent symbols for trajectory and staleness', () => {
    const commands = createSlashCommands({
      getRecentSymbols: () => ['MSFT', 'ASML'],
      getBulkIndices: () => [],
      getWatchlists: () => [],
    });
    const trajectory = commands.find((c) => c.name === 'trajectory');
    const staleness = commands.find((c) => c.name === 'staleness');

    expect(trajectory?.getArgumentCompletions?.('A')).toEqual([
      { value: 'ASML', label: 'ASML', description: 'Recent symbol' },
    ]);
    expect(staleness?.getArgumentCompletions?.('M')).toEqual([
      { value: 'MSFT', label: 'MSFT', description: 'Recent symbol' },
    ]);
  });

  test('builds /trajectory query that mentions get_compliance_trajectory', () => {
    const result = resolveSlashCommand('/trajectory aapl', readyContext);

    expect(result.kind).toBe('run');
    if (result.kind === 'run') {
      expect(result.query).toContain('AAPL');
      expect(result.query).toContain('get_compliance_trajectory');
    }
  });

  test('builds /staleness query that mentions get_screening_staleness', () => {
    const result = resolveSlashCommand('/staleness nvda', readyContext);

    expect(result.kind).toBe('run');
    if (result.kind === 'run') {
      expect(result.query).toContain('NVDA');
      expect(result.query).toContain('get_screening_staleness');
    }
  });

  test('builds /monitor query that fans out to insights tools', () => {
    const result = resolveSlashCommand('/monitor AAPL MSFT NVDA', readyContext);

    expect(result.kind).toBe('run');
    if (result.kind === 'run') {
      expect(result.query).toContain('get_compliance_trajectory');
      expect(result.query).toContain('get_screening_staleness');
      expect(result.query).toContain('get_halal_alternatives');
      expect(result.query).toContain('AAPL, MSFT, NVDA');
    }
  });

  test('/monitor over a watchlist routes through list_watchlists / get_watchlist', () => {
    const result = resolveSlashCommand('/monitor watchlist:Halal Tech', readyContext);

    expect(result.kind).toBe('run');
    if (result.kind === 'run') {
      expect(result.query).toContain('Halal Tech');
      expect(result.query).toContain('get_watchlist');
      expect(result.query).toContain('get_compliance_trajectory');
    }
  });

  test('/monitor warns about token cost for >5 symbols', () => {
    const result = resolveSlashCommand('/monitor AAPL MSFT NVDA TSLA META AMZN GOOGL', readyContext);

    expect(result.kind).toBe('run');
    if (result.kind === 'run') {
      expect(result.query).toContain('expected total token cost');
    }
  });

  test('/ideas with a single symbol prefers get_halal_alternatives', () => {
    const result = resolveSlashCommand('/ideas TSLA', readyContext);

    expect(result.kind).toBe('run');
    if (result.kind === 'run') {
      expect(result.query).toContain('get_halal_alternatives');
    }
  });
});
