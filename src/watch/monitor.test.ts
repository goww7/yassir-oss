import { describe, expect, test } from 'bun:test';
import { formatJsonOutput, parseVerdict } from './monitor.js';

describe('parseVerdict', () => {
  test('reads a boolean compliance verdict', () => {
    expect(parseVerdict({ is_compliant: true })).toEqual({ is_compliant: true });
    expect(parseVerdict({ is_compliant: false })).toEqual({ is_compliant: false });
  });

  describe('formatJsonOutput', () => {
  test('returns machine-readable watch JSON', () => {
    const output = formatJsonOutput(
      ['AAPL', 'MSFT'],
      []
    );

    const parsed = JSON.parse(output);

    expect(parsed.symbols).toEqual(['AAPL', 'MSFT']);
    expect(parsed.changes).toEqual([]);
    expect(parsed.errors).toEqual([]);
    expect(typeof parsed.ts).toBe('string');
  });
});

  test('maps indeterminate / missing / malformed to null', () => {
    expect(parseVerdict({ is_compliant: null })).toEqual({ is_compliant: null });
    expect(parseVerdict({})).toEqual({ is_compliant: null });
    expect(parseVerdict({ is_compliant: 'yes' })).toEqual({ is_compliant: null });
    expect(parseVerdict(null)).toEqual({ is_compliant: null });
    expect(parseVerdict('nope')).toEqual({ is_compliant: null });
  });
});
