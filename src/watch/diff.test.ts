import { describe, expect, test } from 'bun:test';
import { diffVerdicts } from './diff.js';

describe('diffVerdicts', () => {
  test('flags a holding that became non-compliant (the headline alert)', () => {
    const c = diffVerdicts({ AAPL: { is_compliant: true } }, { AAPL: { is_compliant: false } });
    expect(c).toEqual([{ symbol: 'AAPL', kind: 'flipped_out', from: true, to: false }]);
  });

  test('flags a holding that became compliant', () => {
    const c = diffVerdicts({ X: { is_compliant: false } }, { X: { is_compliant: true } });
    expect(c[0]!.kind).toBe('flipped_in');
  });

  test('flags a verdict going indeterminate', () => {
    const c = diffVerdicts({ X: { is_compliant: true } }, { X: { is_compliant: null } });
    expect(c[0]!.kind).toBe('became_unknown');
  });

  test('flags resolution from unknown to a verdict', () => {
    const c = diffVerdicts({ X: { is_compliant: null } }, { X: { is_compliant: false } });
    expect(c[0]!.kind).toBe('resolved');
  });

  test('new symbols are marked new; unchanged are silent', () => {
    const c = diffVerdicts(
      { A: { is_compliant: true } },
      { A: { is_compliant: true }, B: { is_compliant: true } },
    );
    expect(c).toEqual([{ symbol: 'B', kind: 'new', from: undefined, to: true }]);
  });

  test('empty previous state marks everything new (baseline run)', () => {
    const c = diffVerdicts({}, { A: { is_compliant: true }, B: { is_compliant: false } });
    expect(c.map((x) => x.kind)).toEqual(['new', 'new']);
  });
});
