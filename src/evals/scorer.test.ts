import { describe, test, expect } from 'bun:test';
import { computeAggregateStats, formatAggregateReport, type EvalScore } from './scorer.js';

function makeScore(overrides: Partial<{
  accuracy: number;
  completeness: number;
  sourceQuality: number;
  conciseness: number;
  overall: number;
  verdict: EvalScore['overall']['verdict'];
}> = {}): EvalScore {
  return {
    accuracy: { score: overrides.accuracy ?? 0.8, reasoning: 'test' },
    completeness: { score: overrides.completeness ?? 0.7, reasoning: 'test' },
    sourceQuality: { score: overrides.sourceQuality ?? 0.6, reasoning: 'test' },
    conciseness: { score: overrides.conciseness ?? 0.9, reasoning: 'test' },
    overall: {
      score: overrides.overall ?? 0.75,
      verdict: overrides.verdict ?? 'good',
      summary: 'test',
    },
  };
}

describe('computeAggregateStats', () => {
  test('computes stats for single score', () => {
    const scores = [makeScore({ accuracy: 0.8 })];
    const stats = computeAggregateStats(scores);

    expect(stats.count).toBe(1);
    expect(stats.accuracy.mean).toBe(0.8);
    expect(stats.accuracy.median).toBe(0.8);
    expect(stats.accuracy.min).toBe(0.8);
    expect(stats.accuracy.max).toBe(0.8);
    expect(stats.accuracy.stdDev).toBe(0);
  });

  test('computes stats for multiple scores', () => {
    const scores = [
      makeScore({ accuracy: 0.6, overall: 0.5, verdict: 'acceptable' }),
      makeScore({ accuracy: 0.8, overall: 0.7, verdict: 'good' }),
      makeScore({ accuracy: 1.0, overall: 0.9, verdict: 'excellent' }),
    ];
    const stats = computeAggregateStats(scores);

    expect(stats.count).toBe(3);
    expect(stats.accuracy.mean).toBeCloseTo(0.8, 5);
    expect(stats.accuracy.median).toBe(0.8);
    expect(stats.accuracy.min).toBe(0.6);
    expect(stats.accuracy.max).toBe(1.0);
  });

  test('computes verdict distribution', () => {
    const scores = [
      makeScore({ verdict: 'good' }),
      makeScore({ verdict: 'good' }),
      makeScore({ verdict: 'excellent' }),
      makeScore({ verdict: 'poor' }),
    ];
    const stats = computeAggregateStats(scores);

    expect(stats.verdictDistribution.good).toBe(2);
    expect(stats.verdictDistribution.excellent).toBe(1);
    expect(stats.verdictDistribution.poor).toBe(1);
  });

  test('handles empty scores array', () => {
    const stats = computeAggregateStats([]);
    expect(stats.count).toBe(0);
    expect(stats.accuracy.mean).toBe(0);
  });
});

describe('formatAggregateReport', () => {
  test('formats report with all dimensions', () => {
    const scores = [
      makeScore({ accuracy: 0.9, completeness: 0.8, sourceQuality: 0.7, conciseness: 0.85, overall: 0.85, verdict: 'excellent' }),
      makeScore({ accuracy: 0.7, completeness: 0.6, sourceQuality: 0.5, conciseness: 0.75, overall: 0.65, verdict: 'acceptable' }),
    ];
    const stats = computeAggregateStats(scores);
    const report = formatAggregateReport(stats);

    expect(report).toContain('Evaluation Report (2 samples)');
    expect(report).toContain('Accuracy:');
    expect(report).toContain('Completeness:');
    expect(report).toContain('Source Quality:');
    expect(report).toContain('Conciseness:');
    expect(report).toContain('Overall:');
    expect(report).toContain('Verdicts:');
    expect(report).toContain('excellent: 1');
    expect(report).toContain('acceptable: 1');
  });
});
