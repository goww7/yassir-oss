import { describe, expect, test } from 'bun:test';
import { extractReplyShortcutOptions, getReplyShortcutOption } from './reply-shortcuts.js';

describe('extractReplyShortcutOptions', () => {
  test('extracts sequential numbered options', () => {
    const answer = `What I can do next:

1. give you a full portfolio diagnosis
2. classify holdings into quality / speculation / defensive
3. check concentration, currency, and sector risk`;

    expect(extractReplyShortcutOptions(answer)).toEqual([
      { index: 1, text: 'give you a full portfolio diagnosis' },
      { index: 2, text: 'classify holdings into quality / speculation / defensive' },
      { index: 3, text: 'check concentration, currency, and sector risk' },
    ]);
  });

  test('joins wrapped continuation lines', () => {
    const answer = `1. propose a cleanup / rebalance plan
   with the top 3 priorities
2. estimate performance vs cost basis`;

    expect(extractReplyShortcutOptions(answer)).toEqual([
      { index: 1, text: 'propose a cleanup / rebalance plan with the top 3 priorities' },
      { index: 2, text: 'estimate performance vs cost basis' },
    ]);
  });

  test('ignores non-sequential lists', () => {
    const answer = `2. second
3. third`;

    expect(extractReplyShortcutOptions(answer)).toEqual([]);
  });
});

describe('getReplyShortcutOption', () => {
  test('returns a specific numbered option', () => {
    const answer = `1. full diagnosis
2. risk review`;

    expect(getReplyShortcutOption(answer, 2)).toBe('risk review');
    expect(getReplyShortcutOption(answer, 3)).toBeNull();
  });
});
