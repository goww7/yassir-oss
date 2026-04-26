import { describe, test, expect, mock } from 'bun:test';
import { generateResearchPlan, formatPlanForPrompt, type ResearchPlan } from './research-plan.js';

// Mock callLlm to avoid actual API calls
mock.module('../model/llm.js', () => ({
  callLlm: async (prompt: string) => {
    // Simulate plan generation based on query length
    if (prompt.length < 40) {
      return { response: 'SIMPLE', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } };
    }
    return {
      response: '1. Get financial data for AAPL\n2. Get financial data for MSFT\n3. Compare key metrics\n4. Synthesize recommendation',
      usage: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
    };
  },
  getFastModel: (provider: string, fallback: string) => fallback,
}));

mock.module('../providers.js', () => ({
  resolveProvider: () => ({ id: 'openai', displayName: 'OpenAI', modelPrefix: '' }),
}));

describe('generateResearchPlan', () => {
  test('skips planning for short queries', async () => {
    const plan = await generateResearchPlan('AAPL price', 'gpt-5.4');
    expect(plan.needsPlan).toBe(false);
    expect(plan.steps).toHaveLength(0);
    expect(plan.planText).toBe('');
  });

  test('skips planning when LLM returns SIMPLE', async () => {
    const plan = await generateResearchPlan('What is the current PE ratio?', 'gpt-5.4');
    // 9 words, > 8 threshold, but LLM says SIMPLE
    expect(plan.needsPlan).toBe(false);
  });

  test('generates plan for complex queries', async () => {
    const plan = await generateResearchPlan(
      'Compare Apple and Microsoft financial performance over the last 3 years and recommend which is a better investment',
      'gpt-5.4',
    );
    expect(plan.needsPlan).toBe(true);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.planText).toContain('1.');
  });
});

describe('formatPlanForPrompt', () => {
  test('returns empty string for no-plan', () => {
    const plan: ResearchPlan = { needsPlan: false, steps: [], planText: '' };
    expect(formatPlanForPrompt(plan)).toBe('');
  });

  test('formats plan with header and steps', () => {
    const plan: ResearchPlan = {
      needsPlan: true,
      steps: ['Get AAPL data', 'Analyze trends'],
      planText: '1. Get AAPL data\n2. Analyze trends',
    };
    const result = formatPlanForPrompt(plan);
    expect(result).toContain('## Research Plan');
    expect(result).toContain('1. Get AAPL data');
    expect(result).toContain('2. Analyze trends');
  });
});
