import { describe, expect, test } from 'bun:test';
import { formatChange, alertableChanges } from './alert.js';
import type { Change } from './diff.js';

describe('watch alerts', () => {
  test('formats a flipped_out change prominently', () => {
    const s = formatChange({ symbol: 'AAPL', kind: 'flipped_out', from: true, to: false });
    expect(s).toContain('AAPL');
    expect(s).toContain('🔴');
  });

  test('alertableChanges drops baseline "new" by default', () => {
    const changes: Change[] = [
      { symbol: 'A', kind: 'new', from: undefined, to: true },
      { symbol: 'B', kind: 'flipped_out', from: true, to: false },
    ];
    expect(alertableChanges(changes).map((c) => c.symbol)).toEqual(['B']);
  });

  test('alertableChanges can include baseline when asked', () => {
    const changes: Change[] = [{ symbol: 'A', kind: 'new', from: undefined, to: true }];
    expect(alertableChanges(changes, true)).toHaveLength(1);
  });
});
