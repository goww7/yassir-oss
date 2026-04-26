import { callLlm } from '../model/llm.js';
import { getFastModel } from '../model/llm.js';
import { resolveProvider } from '../providers.js';
import { getCurrentDate } from './prompts.js';
import type { TokenUsage } from './types.js';

/**
 * A lightweight research plan generated before the main agent loop.
 * Decomposes complex queries into ordered research steps.
 */
export interface ResearchPlan {
  /** Whether this query needs a plan (simple queries skip planning) */
  needsPlan: boolean;
  /** Ordered list of research steps */
  steps: string[];
  /** Raw plan text for injection into the iteration prompt */
  planText: string;
  /** Token usage from the planning call */
  usage?: TokenUsage;
}

const PLAN_SYSTEM_PROMPT = `You are a research planning assistant. Your job is to decompose a user's research query into a minimal, ordered list of concrete data-gathering and analysis steps.

Current date: ${getCurrentDate()}

Rules:
- Output ONLY a numbered list of 2-6 steps. No preamble, no explanation.
- Each step should be a concrete action: "Get X data for Y", "Compare X across Y", "Analyze X to determine Y"
- Order steps by dependency: data gathering first, analysis/synthesis last
- If the query is simple and direct (e.g., "What is AAPL's P/E ratio?"), output exactly: SIMPLE
- Focus on WHAT data to get and WHAT analysis to perform, not HOW (the agent picks tools)
- Be specific about entities (tickers, metrics, time periods) mentioned in the query`;

/**
 * Generate a lightweight research plan for a query.
 * Uses the fast model to minimize latency and cost.
 * Returns immediately for simple/direct queries.
 */
export async function generateResearchPlan(
  query: string,
  model: string,
  signal?: AbortSignal,
): Promise<ResearchPlan> {
  // Skip planning for very short queries (likely simple lookups)
  if (query.split(/\s+/).length <= 8) {
    return { needsPlan: false, steps: [], planText: '' };
  }

  const provider = resolveProvider(model);
  const fastModel = getFastModel(provider.id, model);

  try {
    const result = await callLlm(query, {
      model: fastModel,
      systemPrompt: PLAN_SYSTEM_PROMPT,
      signal,
    });

    const text = typeof result.response === 'string'
      ? result.response
      : (result.response as { content: string }).content ?? '';

    const trimmed = text.trim();

    // Simple query detection
    if (trimmed === 'SIMPLE' || trimmed.startsWith('SIMPLE')) {
      return { needsPlan: false, steps: [], planText: '', usage: result.usage };
    }

    // Parse numbered steps
    const steps = trimmed
      .split('\n')
      .map(line => line.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(line => line.length > 0);

    if (steps.length === 0) {
      return { needsPlan: false, steps: [], planText: '', usage: result.usage };
    }

    const planText = steps.map((step, i) => `${i + 1}. ${step}`).join('\n');

    return {
      needsPlan: true,
      steps,
      planText,
      usage: result.usage,
    };
  } catch {
    // Planning failure is non-fatal — agent proceeds without a plan
    return { needsPlan: false, steps: [], planText: '' };
  }
}

/**
 * Format the research plan for injection into the iteration prompt.
 */
export function formatPlanForPrompt(plan: ResearchPlan): string {
  if (!plan.needsPlan || plan.steps.length === 0) {
    return '';
  }

  return `## Research Plan

Follow this plan to answer the query systematically. Check off steps as you complete them.

${plan.planText}

Execute the plan step by step. You may adapt if you discover the plan needs adjustment based on data found.`;
}
