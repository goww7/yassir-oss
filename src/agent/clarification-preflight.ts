import { z } from 'zod';
import { getCurrentProfile } from '../profile/current.js';
import { callLlm, getFastModel } from '../model/llm.js';
import type { GuidedQaOption, GuidedQaRunContext, GuidedQaSummaryEntry } from '../controllers/guided-qa-controller.js';
import type { ProfileGuidedQaWorkflow } from '../profile/types.js';

const ClarificationDecisionSchema = z.object({
  outcome: z.enum(['proceed', 'ask_inline', 'ask_structured']),
  label: z.string().optional(),
  question: z.string().optional(),
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string(),
        description: z.string().optional(),
      }),
    )
    .max(5)
    .optional(),
});

export interface ClarificationDecision {
  outcome: 'proceed' | 'ask_inline' | 'ask_structured';
  label?: string;
  question?: string;
  options?: GuidedQaOption[];
}

export interface ClarificationPreflightParams {
  query: string;
  model: string;
  modelProvider: string;
  seedWorkflow?: ProfileGuidedQaWorkflow | null;
  answers?: GuidedQaSummaryEntry[];
  clarificationCount?: number;
}

const BROAD_INTENT_HINTS = [
  'analyze',
  'analysis',
  'benchmark',
  'benchmarks',
  'benchmarking',
  'compare',
  'comparison',
  'diligence',
  'memo',
  'brief',
  'review',
  'assess',
  'evaluate',
  'map',
  'strategy',
  'landscape',
];

const SCOPE_HINTS = [
  'with ',
  'including',
  'focus on',
  'cover ',
  'across ',
  'versus',
  ' vs ',
  'over the next',
  'using ',
  'based on',
  'from ',
  'between ',
];

function buildWorkflowSeedText(workflow?: ProfileGuidedQaWorkflow | null): string {
  if (!workflow) {
    return 'No explicit workflow seed was provided.';
  }

  return [
    `Seeded workflow: ${workflow.label}`,
    `Description: ${workflow.description}`,
    workflow.triggerKeywords?.length ? `Keywords: ${workflow.triggerKeywords.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildAnswerContext(entries: GuidedQaSummaryEntry[]): string {
  if (entries.length === 0) {
    return 'No clarification answers yet.';
  }

  return entries.map((entry) => `- ${entry.label}: ${entry.value}`).join('\n');
}

const CLARIFICATION_PREFLIGHT_SYSTEM_PROMPT = `You decide whether a research assistant should ask one clarification question before starting deeper work.

Rules:
- Default to proceed when the user is already specific enough.
- Ask a clarification only if the missing information would materially change scope, source selection, or answer shape.
- Never ask generic filler like "can you clarify?".
- If you ask, ask exactly one sharp question.
- Prefer ask_inline for free-text follow-ups.
- Use ask_structured only when 2 to 5 explicit options will be faster and clearer than free text.
- If prior clarification answers already make the task clear enough, choose proceed.
- Avoid clarification for operational requests, direct factual asks, or clearly scoped analysis.
- Keep labels short, like "Deliverable", "Focus", or "Horizon".`;

export function shouldRunClarificationPreflight(params: {
  query: string;
  seedWorkflow?: ProfileGuidedQaWorkflow | null;
  clarificationCount?: number;
}): boolean {
  if ((params.clarificationCount ?? 0) > 0) {
    return true;
  }

  if (params.seedWorkflow) {
    return true;
  }

  const query = params.query.trim().toLowerCase();
  if (!query) {
    return false;
  }

  const words = query.split(/\s+/).filter(Boolean);
  const hasBroadIntent = BROAD_INTENT_HINTS.some((hint) => query.includes(hint));
  const hasScopeDetail =
    SCOPE_HINTS.some((hint) => query.includes(hint)) ||
    query.includes(',') ||
    query.includes(':') ||
    words.length >= 18;

  if (!hasBroadIntent) {
    return false;
  }

  if (hasScopeDetail) {
    return false;
  }

  return words.length <= 12 || query.length <= 90;
}

export async function runClarificationPreflight(
  params: ClarificationPreflightParams,
): Promise<ClarificationDecision> {
  const currentProfile = getCurrentProfile();
  const workflows = currentProfile.vertical.guidedQa?.workflows ?? [];
  const fastModel = getFastModel(params.modelProvider, params.model);

  const prompt = `Profile: ${currentProfile.brand.name} · ${currentProfile.vertical.label}

User request:
${params.query}

Seed context:
${buildWorkflowSeedText(params.seedWorkflow)}

Prior clarification answers:
${buildAnswerContext(params.answers ?? [])}

Clarification rounds already used: ${params.clarificationCount ?? 0}

Available workflow seeds:
${workflows.map((workflow) => `- ${workflow.label}: ${workflow.description}`).join('\n') || '- none'}

Decide whether to proceed, ask one inline question, or ask one structured-choice question.`;

  try {
    const { response } = await callLlm(prompt, {
      model: fastModel,
      systemPrompt: CLARIFICATION_PREFLIGHT_SYSTEM_PROMPT,
      outputSchema: ClarificationDecisionSchema,
    });

    const parsed = ClarificationDecisionSchema.safeParse(response);
    if (!parsed.success) {
      return { outcome: 'proceed' };
    }
    if (
      parsed.data.outcome === 'ask_structured' &&
      (!parsed.data.question || !parsed.data.options || parsed.data.options.length < 2)
    ) {
      return { outcome: 'proceed' };
    }
    if (parsed.data.outcome !== 'proceed' && !parsed.data.question) {
      return { outcome: 'proceed' };
    }
    return {
      outcome: parsed.data.outcome,
      label: parsed.data.label?.trim() || undefined,
      question: parsed.data.question?.trim() || undefined,
      options: parsed.data.options?.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
      })),
    };
  } catch {
    return { outcome: 'proceed' };
  }
}

export function buildClarificationContext(context: GuidedQaRunContext): Omit<GuidedQaRunContext, 'enrichedQuery'> {
  return {
    originalQuery: context.originalQuery,
    entries: context.entries,
    autoTriggered: context.autoTriggered,
    seedWorkflowId: context.seedWorkflowId,
    seedWorkflowLabel: context.seedWorkflowLabel,
  };
}
