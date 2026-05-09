import { describe, expect, test } from 'bun:test';
import { summarizeGetShariahData } from './summarize-get-shariah-result.js';

describe('summarizeGetShariahData', () => {
  test('quota-blocked workflow surfaces action-required wording', () => {
    const summary = summarizeGetShariahData({
      _workflow: {
        completeness: 'quota_blocked',
        recovery: { dashboardUrl: 'https://api.halalterminal.com/dashboard/' },
      },
      screen_stock_shariah: { error: 'tokens_used' },
    });

    expect(summary).toContain('action required');
    expect(summary).toContain('refill or upgrade');
  });

  test('errors take precedence over dataset count', () => {
    const summary = summarizeGetShariahData({
      _errors: [{ tool: 'screen_stock_shariah', error: 'Symbol not found' }],
    });

    expect(summary).toContain('1 error');
    expect(summary).toContain('Symbol not found');
  });

  test('ETF disposition is rendered explicitly with attestation count', () => {
    const summary = summarizeGetShariahData({
      screen_etf_shariah: {
        symbol: 'SPUS',
        disposition: 'compliant_with_purification',
        is_etf: true,
        app_compliance_status: 'compliant_with_purification',
        methodology_attestations: { aaoifi: 'Scholar X', ftse: 'Scholar Y' },
      },
    });

    expect(summary).toContain('ETF disposition: compliant_with_purification');
    expect(summary).toContain('2 scholar attestation');
  });

  test('abstain status surfaces the abstain reason', () => {
    const summary = summarizeGetShariahData({
      screen_stock_shariah: {
        symbol: 'TSM',
        app_compliance_status: 'abstain',
        abstain_reason: 'Financial currency mismatch (TWD vs USD).',
      },
    });

    expect(summary).toContain('abstained');
    expect(summary).toContain('currency mismatch');
  });

  test('degraded sources are surfaced as partial with the note', () => {
    const summary = summarizeGetShariahData({
      get_compliance_trajectory: {
        symbol: 'AAPL',
        trajectory: [],
        degraded_sources: ['SEC EDGAR temporarily unavailable; trajectory based on cached XBRL.'],
      },
    });

    expect(summary).toContain('partial');
    expect(summary).toContain('SEC EDGAR');
  });

  test('clean dataset stays compact', () => {
    const summary = summarizeGetShariahData({
      screen_stock_shariah: { symbol: 'AAPL', is_compliant: true },
      get_result: { symbol: 'AAPL' },
    });

    expect(summary).toBe('Shariah · 2 dataset(s)');
  });

  test('empty payload falls back to no-data wording', () => {
    expect(summarizeGetShariahData({})).toBe('Shariah · no screening data returned');
  });
});
