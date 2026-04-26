import { describe, expect, test } from 'bun:test';
import { shouldRunClarificationPreflight } from './clarification-preflight.js';

describe('shouldRunClarificationPreflight', () => {
  test('skips preflight for specific scoped prompts', () => {
    expect(
      shouldRunClarificationPreflight({
        query: 'Benchmark CrowdStrike vs Palo Alto with focus on valuation, growth, and margins.',
      }),
    ).toBe(false);
  });

  test('runs preflight for short broad research prompts', () => {
    expect(
      shouldRunClarificationPreflight({
        query: 'Give me a benchmark on Lombard Odier',
      }),
    ).toBe(true);
  });

  test('always runs after a prior clarification round', () => {
    expect(
      shouldRunClarificationPreflight({
        query: 'Lombard Odier',
        clarificationCount: 1,
      }),
    ).toBe(true);
  });
});
