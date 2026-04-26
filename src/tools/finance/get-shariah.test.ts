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
});
