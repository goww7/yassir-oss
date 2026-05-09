import { describe, expect, test } from 'bun:test';
import { normalizeHalalData } from './shariah.js';

describe('normalizeHalalData', () => {
  test('marks unresolved screening results as unknown for app consumers', () => {
    const normalized = normalizeHalalData({
      symbol: 'ONTO',
      is_compliant: false,
      business_screen_reason: "Symbol 'ONTO' not found in any database.",
      aaoifi_compliant: null,
      djim_compliant: null,
      ftse_compliant: null,
      msci_compliant: null,
      sp_compliant: null,
    }) as Record<string, unknown>;

    expect(normalized.resolution_status).toBe('unresolved');
    expect(normalized.app_compliance_status).toBe('unknown');
    expect(normalized.backend_verdict_warning).toBeString();
  });

  test('does not modify valid resolved screening results', () => {
    const normalized = normalizeHalalData({
      symbol: 'MSFT',
      is_compliant: true,
      business_screen_reason: 'Business activity is compliant.',
      aaoifi_compliant: true,
      djim_compliant: true,
      ftse_compliant: true,
      msci_compliant: true,
      sp_compliant: true,
    }) as Record<string, unknown>;

    expect(normalized.resolution_status).toBeUndefined();
    expect(normalized.app_compliance_status).toBeUndefined();
    expect(normalized.is_compliant).toBe(true);
  });

  test('builds a verification summary from methodology_results.verified flags', () => {
    const normalized = normalizeHalalData({
      symbol: 'AAPL',
      methodology_results: {
        aaoifi: { verified: true, status: 'COMPLIANT' },
        djim: { verified: false, status: 'COMPLIANT' },
        ftse: { verified: true, status: 'COMPLIANT' },
        msci: { verified: true, status: 'COMPLIANT' },
        sp: { verified: false, status: 'COMPLIANT' },
      },
    }) as Record<string, unknown>;

    expect(normalized.verification_summary).toBe(
      'AAOIFI scholar-verified · DJIM unverified · FTSE scholar-verified · MSCI scholar-verified · S&P unverified',
    );
  });

  test('promotes ETF v2 disposition to app_compliance_status and tags is_etf', () => {
    const normalized = normalizeHalalData({
      symbol: 'SPUS',
      disposition: 'compliant_with_purification',
      methodology_attestations: {
        aaoifi: 'Scholar X, dated 2026-04-12',
        ftse: 'Scholar Y, dated 2026-04-12',
      },
    }) as Record<string, unknown>;

    expect(normalized.app_compliance_status).toBe('compliant_with_purification');
    expect(normalized.is_etf).toBe(true);
    expect(normalized.disposition).toBe('compliant_with_purification');
  });

  test('marks INSUFFICIENT_DATA top-level results as abstain with reason', () => {
    const normalized = normalizeHalalData({
      symbol: 'TSM',
      compliance_status: 'INSUFFICIENT_DATA',
      reason: 'Financial currency (TWD) does not match market currency (USD).',
    }) as Record<string, unknown>;

    expect(normalized.app_compliance_status).toBe('abstain');
    expect(normalized.abstain_reason).toContain('currency');
  });

  test('marks per-methodology INSUFFICIENT_DATA as abstain', () => {
    const normalized = normalizeHalalData({
      symbol: 'BABA',
      methodology_results: {
        aaoifi: { status: 'INSUFFICIENT_DATA', reason: 'CNY/USD financial currency mismatch.' },
      },
    }) as Record<string, unknown>;

    expect(normalized.app_compliance_status).toBe('abstain');
    expect(normalized.abstain_reason).toContain('CNY');
  });

  test('aggregates degraded_sources from a 200+note insights response', () => {
    const normalized = normalizeHalalData({
      symbol: 'AAPL',
      trajectory: [],
      note: 'SEC EDGAR temporarily unavailable; trajectory based on cached XBRL.',
    }) as Record<string, unknown>;

    expect(Array.isArray(normalized.degraded_sources)).toBe(true);
    expect((normalized.degraded_sources as string[])[0]).toContain('SEC EDGAR');
  });

  test('honors explicit degraded=true with no note', () => {
    const normalized = normalizeHalalData({
      symbol: 'AAPL',
      degraded: true,
    }) as Record<string, unknown>;

    expect(Array.isArray(normalized.degraded_sources)).toBe(true);
    expect((normalized.degraded_sources as string[]).length).toBe(1);
  });

  test('builds verification_summary from by_methodology with uppercase keys', () => {
    const normalized = normalizeHalalData({
      symbol: 'TSM',
      by_methodology: {
        AAOIFI: { is_compliant: false, verified: true, reason: null },
        DJIM: { is_compliant: false, verified: false, reason: null },
        FTSE: { is_compliant: false, verified: true, reason: null },
        MSCI: { is_compliant: false, verified: true, reason: null },
        SP: { is_compliant: false, verified: false, reason: null },
      },
    }) as Record<string, unknown>;

    expect(normalized.verification_summary).toBe(
      'AAOIFI scholar-verified · DJIM unverified · FTSE scholar-verified · MSCI scholar-verified · S&P unverified',
    );
  });

  test('marks abstain when data_quality.methodologies_insufficient covers all methodologies', () => {
    const normalized = normalizeHalalData({
      symbol: 'TSM',
      is_compliant: false,
      compliance_status: null,
      by_methodology: {
        AAOIFI: { is_compliant: false, verified: true, reason: null },
      },
      data_quality: {
        missing_fields: ['revenue', 'interest_income'],
        methodologies_insufficient: ['AAOIFI', 'DJIM', 'FTSE', 'MSCI', 'SP'],
      },
    }) as Record<string, unknown>;

    expect(normalized.app_compliance_status).toBe('abstain');
    expect(normalized.abstain_reason).toContain('All methodologies');
    expect(normalized.abstain_reason).toContain('revenue');
  });

  test('marks abstain when data_quality.methodologies_insufficient covers a subset', () => {
    const normalized = normalizeHalalData({
      symbol: 'X',
      data_quality: {
        missing_fields: ['interest_income'],
        methodologies_insufficient: ['AAOIFI', 'FTSE'],
      },
    }) as Record<string, unknown>;

    expect(normalized.app_compliance_status).toBe('abstain');
    expect(normalized.abstain_reason).toContain('AAOIFI');
    expect(normalized.abstain_reason).toContain('FTSE');
  });

  test('does not flag a happy-path note as degraded', () => {
    const normalized = normalizeHalalData({
      symbol: 'TSLA',
      source_status: 'compliant',
      alternatives: [],
      note: 'Source ticker is already Shariah-compliant; no alternative needed.',
    }) as Record<string, unknown>;

    expect(normalized.degraded_sources).toBeUndefined();
  });

  test('flags a SEC-fetch-failure note as degraded', () => {
    const normalized = normalizeHalalData({
      symbol: 'AAPL',
      quarters_returned: 0,
      trajectory: [],
      note: 'SEC XBRL fetch failed: 403 Client Error: Forbidden for url: https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json',
    }) as Record<string, unknown>;

    expect(Array.isArray(normalized.degraded_sources)).toBe(true);
    expect((normalized.degraded_sources as string[])[0]).toContain('SEC XBRL');
  });
});
