import { describe, expect, test } from 'bun:test';
import {
  classifyShariahIssue,
  getFallbackToolCalls,
  maybePreflightToolCalls,
} from './get-shariah.js';

describe('get_shariah workflow helpers', () => {
  test('adds quota preflight for expensive calls', () => {
    const planned = maybePreflightToolCalls(
      [{ name: 'screen_index_bulk', args: { index_name: 'SP500' } }],
      'screen the s&p 500',
    );

    expect(planned[0]).toEqual({ name: 'get_key_usage', args: {} });
    expect(planned[1]).toEqual({ name: 'get_token_costs', args: {} });
    expect(planned[2]).toEqual({ name: 'screen_index_bulk', args: { index_name: 'SP500' } });
  });

  test('classifies unresolved backend payloads correctly', () => {
    const issue = classifyShariahIssue({
      data: {
        resolution_status: 'unresolved',
        app_compliance_status: 'unknown',
      },
      error: null,
    });

    expect(issue).toBe('unresolved');
  });

  test('builds symbol resolution fallbacks for unresolved stock screens', () => {
    const fallbacks = getFallbackToolCalls(
      { name: 'screen_stock_shariah', args: { symbol: 'ONTO' } },
      'unresolved',
    );

    expect(fallbacks).toEqual([
      { name: 'suggest_symbol', args: { q: 'ONTO' } },
      { name: 'search_halal_database', args: { q: 'ONTO', asset_type: 'equities', limit: 5 } },
    ]);
  });

  test('builds cached-result fallbacks for quota-limited portfolio scans', () => {
    const fallbacks = getFallbackToolCalls(
      { name: 'scan_portfolio_shariah', args: { symbols: ['AAPL', 'MSFT', 'GOOGL'] } },
      'quota',
    );

    expect(fallbacks).toEqual([
      { name: 'get_result', args: { symbol: 'AAPL' } },
      { name: 'get_result', args: { symbol: 'MSFT' } },
      { name: 'get_result', args: { symbol: 'GOOGL' } },
    ]);
  });

  test('strips revoke_key from non-mutation queries', () => {
    const planned = maybePreflightToolCalls(
      [
        { name: 'screen_stock_shariah', args: { symbol: 'AAPL' } },
        { name: 'revoke_key', args: { confirm: true } },
      ],
      'is apple halal',
    );

    expect(planned.find((tc) => tc.name === 'revoke_key')).toBeUndefined();
  });

  test('keeps revoke_key when the query explicitly asks to revoke', () => {
    const planned = maybePreflightToolCalls(
      [{ name: 'revoke_key', args: { confirm: true } }],
      'revoke my halal terminal key',
    );

    expect(planned.find((tc) => tc.name === 'revoke_key')).toEqual({
      name: 'revoke_key',
      args: { confirm: true },
    });
  });

  test('passes through insights tool calls without mutation gating', () => {
    const planned = maybePreflightToolCalls(
      [
        { name: 'get_compliance_trajectory', args: { symbol: 'AAPL' } },
        { name: 'get_screening_staleness', args: { symbol: 'AAPL' } },
        { name: 'get_halal_alternatives', args: { symbol: 'TSLA' } },
      ],
      'is aapl drifting and what could replace tsla',
    );

    expect(planned.map((tc) => tc.name)).toEqual([
      'get_compliance_trajectory',
      'get_screening_staleness',
      'get_halal_alternatives',
    ]);
  });
});
