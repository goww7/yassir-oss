/**
 * Multi-dimensional LLM-as-judge evaluation scorer.
 * Grades agent answers on accuracy, completeness, source quality, and conciseness.
 */

import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

// ============================================================================
// Schema
// ============================================================================

export const EvalScoreSchema = z.object({
  accuracy: z.object({
    score: z.number().min(0).max(1).describe('1 = all facts correct, 0 = major errors'),
    reasoning: z.string().describe('Brief explanation of factual accuracy assessment'),
  }),
  completeness: z.object({
    score: z.number().min(0).max(1).describe('1 = covers all key aspects, 0 = major gaps'),
    reasoning: z.string().describe('Brief explanation of what was covered vs missed'),
  }),
  sourceQuality: z.object({
    score: z.number().min(0).max(1).describe('1 = cites specific data/sources, 0 = unsupported claims'),
    reasoning: z.string().describe('Brief assessment of evidence backing'),
  }),
  conciseness: z.object({
    score: z.number().min(0).max(1).describe('1 = direct and well-structured, 0 = verbose/unfocused'),
    reasoning: z.string().describe('Brief assessment of response efficiency'),
  }),
  overall: z.object({
    score: z.number().min(0).max(1).describe('Weighted overall score'),
    verdict: z.enum(['excellent', 'good', 'acceptable', 'poor', 'fail']),
    summary: z.string().describe('One-sentence overall assessment'),
  }),
});

export type EvalScore = z.infer<typeof EvalScoreSchema>;

// ============================================================================
// Scorer
// ============================================================================

const SCORER_SYSTEM_PROMPT = `You are an expert financial research evaluator. You grade AI assistant responses to financial research questions on four dimensions:

1. **Accuracy** (weight: 40%): Are the facts, numbers, and claims correct? Cross-reference against the reference answer.
2. **Completeness** (weight: 30%): Does the answer address all parts of the question? Any significant gaps?
3. **Source Quality** (weight: 20%): Does the answer cite specific data points, filings, or sources? Or is it generic?
4. **Conciseness** (weight: 10%): Is the answer direct and well-structured, or verbose and unfocused?

Scoring guide:
- 1.0 = Perfect or near-perfect
- 0.8 = Good with minor issues
- 0.6 = Acceptable with notable gaps
- 0.4 = Below expectations, significant issues
- 0.2 = Poor, mostly wrong or missing
- 0.0 = Completely wrong or empty

For the overall score, compute: accuracy*0.4 + completeness*0.3 + sourceQuality*0.2 + conciseness*0.1

Verdicts: excellent (>=0.85), good (>=0.7), acceptable (>=0.5), poor (>=0.3), fail (<0.3)

Be a tough but fair grader. Financial research demands precision.`;

export interface ScorerOptions {
  /** Model to use for evaluation (default: gpt-5.4) */
  model?: string;
  /** OpenAI API key (uses OPENAI_API_KEY env var if not provided) */
  apiKey?: string;
}

/**
 * Create an evaluation scorer instance.
 */
export function createScorer(options: ScorerOptions = {}) {
  const model = options.model ?? 'gpt-5.4';
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;

  const llm = new ChatOpenAI({ model, apiKey });
  const structuredLlm = llm.withStructuredOutput(EvalScoreSchema);

  return {
    /**
     * Score a single answer against a reference.
     */
    async score(params: {
      question: string;
      answer: string;
      referenceAnswer: string;
      toolCalls?: Array<{ tool: string; args: Record<string, unknown> }>;
    }): Promise<EvalScore> {
      const toolContext = params.toolCalls?.length
        ? `\nTools used: ${params.toolCalls.map(t => `${t.tool}(${Object.entries(t.args).map(([k, v]) => `${k}=${v}`).join(', ')})`).join(', ')}`
        : '';

      const prompt = `Evaluate the following AI response to a financial research question.

**Question:**
${params.question}

**Reference Answer (ground truth):**
${params.referenceAnswer}

**AI Response:**
${params.answer}${toolContext}

Grade the response on all four dimensions and provide an overall score.`;

      try {
        return await structuredLlm.invoke([
          { role: 'system', content: SCORER_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ]);
      } catch (error) {
        // Return a failure score if the evaluator itself errors
        return {
          accuracy: { score: 0, reasoning: `Evaluator error: ${error instanceof Error ? error.message : String(error)}` },
          completeness: { score: 0, reasoning: 'Evaluator error' },
          sourceQuality: { score: 0, reasoning: 'Evaluator error' },
          conciseness: { score: 0, reasoning: 'Evaluator error' },
          overall: { score: 0, verdict: 'fail', summary: 'Evaluation failed due to error' },
        };
      }
    },

    /**
     * Score a batch of answers and return aggregate statistics.
     */
    async scoreBatch(items: Array<{
      question: string;
      answer: string;
      referenceAnswer: string;
      toolCalls?: Array<{ tool: string; args: Record<string, unknown> }>;
    }>): Promise<{
      scores: EvalScore[];
      aggregate: AggregateStats;
    }> {
      const scores: EvalScore[] = [];

      for (const item of items) {
        const score = await this.score(item);
        scores.push(score);
      }

      return {
        scores,
        aggregate: computeAggregateStats(scores),
      };
    },
  };
}

// ============================================================================
// Aggregate Statistics
// ============================================================================

export interface AggregateStats {
  count: number;
  accuracy: DimensionStats;
  completeness: DimensionStats;
  sourceQuality: DimensionStats;
  conciseness: DimensionStats;
  overall: DimensionStats;
  verdictDistribution: Record<string, number>;
}

export interface DimensionStats {
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
}

function computeDimensionStats(values: number[]): DimensionStats {
  if (values.length === 0) {
    return { mean: 0, median: 0, min: 0, max: 0, stdDev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return { mean, median, min, max, stdDev };
}

export function computeAggregateStats(scores: EvalScore[]): AggregateStats {
  const verdictDistribution: Record<string, number> = {};
  for (const score of scores) {
    const verdict = score.overall.verdict;
    verdictDistribution[verdict] = (verdictDistribution[verdict] ?? 0) + 1;
  }

  return {
    count: scores.length,
    accuracy: computeDimensionStats(scores.map(s => s.accuracy.score)),
    completeness: computeDimensionStats(scores.map(s => s.completeness.score)),
    sourceQuality: computeDimensionStats(scores.map(s => s.sourceQuality.score)),
    conciseness: computeDimensionStats(scores.map(s => s.conciseness.score)),
    overall: computeDimensionStats(scores.map(s => s.overall.score)),
    verdictDistribution,
  };
}

/**
 * Format aggregate stats as a human-readable report.
 */
export function formatAggregateReport(stats: AggregateStats): string {
  const fmt = (d: DimensionStats) =>
    `mean=${d.mean.toFixed(2)} median=${d.median.toFixed(2)} min=${d.min.toFixed(2)} max=${d.max.toFixed(2)} stdDev=${d.stdDev.toFixed(2)}`;

  const verdicts = Object.entries(stats.verdictDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([v, c]) => `${v}: ${c}`)
    .join(', ');

  return `Evaluation Report (${stats.count} samples)
${'='.repeat(50)}
Accuracy:      ${fmt(stats.accuracy)}
Completeness:  ${fmt(stats.completeness)}
Source Quality: ${fmt(stats.sourceQuality)}
Conciseness:   ${fmt(stats.conciseness)}
${'─'.repeat(50)}
Overall:       ${fmt(stats.overall)}
Verdicts:      ${verdicts}`;
}
