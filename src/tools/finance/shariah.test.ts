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
});
