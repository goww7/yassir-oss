import { getCurrentProfile } from '../profile/current.js';
import type { ProfileGuidedQaWorkflow } from '../profile/types.js';

export type GuidedQaAppState = 'idle' | 'workflow_select' | 'structured_question';
export type GuidedQaQuestionMode = 'inline' | 'single_select';

export interface GuidedQaOption {
  value: string;
  label: string;
  description?: string;
}

export interface GuidedQaPrompt {
  label?: string;
  question: string;
  mode: GuidedQaQuestionMode;
  options?: GuidedQaOption[];
}

export interface GuidedQaSummaryEntry {
  label: string;
  value: string;
}

export interface GuidedQaRunContext {
  originalQuery: string;
  enrichedQuery: string;
  entries: GuidedQaSummaryEntry[];
  autoTriggered: boolean;
  seedWorkflowId?: string;
  seedWorkflowLabel?: string;
}

export interface GuidedQaState {
  appState: GuidedQaAppState;
  originalQuery: string;
  workflows: ProfileGuidedQaWorkflow[];
  seedWorkflow: ProfileGuidedQaWorkflow | null;
  pendingPrompt: GuidedQaPrompt | null;
  entries: GuidedQaSummaryEntry[];
  autoTriggered: boolean;
  clarificationCount: number;
}

function getGuidedQaWorkflows(): ProfileGuidedQaWorkflow[] {
  return getCurrentProfile().vertical.guidedQa?.workflows ?? [];
}

function formatOptionValue(options: GuidedQaOption[] | undefined, value: string): string {
  return options?.find((option) => option.value === value)?.label ?? value;
}

export function buildGuidedQaPrompt(
  context: {
    originalQuery: string;
    entries: GuidedQaSummaryEntry[];
    seedWorkflow?: ProfileGuidedQaWorkflow | null;
  },
): string {
  const lines = [`User request: ${context.originalQuery}`];

  if (context.seedWorkflow || context.entries.length > 0) {
    lines.push('', 'Clarification context:');
    if (context.seedWorkflow) {
      lines.push(`- Requested workflow: ${context.seedWorkflow.label}`);
      lines.push(`- Workflow goal: ${context.seedWorkflow.description}`);
      if (context.seedWorkflow.executionHint) {
        lines.push(`- Execution hint: ${context.seedWorkflow.executionHint}`);
      }
    }
    for (const entry of context.entries) {
      lines.push(`- ${entry.label}: ${entry.value}`);
    }
    if (context.seedWorkflow?.outputSections?.length) {
      lines.push(`- Expected output: ${context.seedWorkflow.outputSections.join(' | ')}`);
    }
    lines.push(
      '',
      'Treat the clarification context as explicit user constraints. Use it to shape scope, source selection, and answer structure.',
    );
  }

  return lines.join('\n');
}

export class GuidedQaController {
  private _state: GuidedQaState = {
    appState: 'idle',
    originalQuery: '',
    workflows: [],
    seedWorkflow: null,
    pendingPrompt: null,
    entries: [],
    autoTriggered: false,
    clarificationCount: 0,
  };
  private readonly onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate;
  }

  get state(): GuidedQaState {
    return this._state;
  }

  isActive(): boolean {
    return this._state.appState === 'workflow_select' || this._state.appState === 'structured_question';
  }

  hasPendingSession(): boolean {
    return Boolean(this._state.originalQuery);
  }

  isAwaitingInline(): boolean {
    return this._state.pendingPrompt?.mode === 'inline';
  }

  hasPendingPrompt(): boolean {
    return Boolean(this._state.pendingPrompt);
  }

  getPendingPrompt(): GuidedQaPrompt | null {
    return this._state.pendingPrompt;
  }

  startSession(query: string, options?: { workflowId?: string; manual?: boolean; autoTriggered?: boolean }): boolean {
    const workflows = getGuidedQaWorkflows();
    if (workflows.length === 0) {
      return false;
    }

    if (options?.manual && !options.workflowId) {
      this._state = {
        appState: 'workflow_select',
        originalQuery: query,
        workflows,
        seedWorkflow: null,
        pendingPrompt: null,
        entries: [],
        autoTriggered: false,
        clarificationCount: 0,
      };
      this.onUpdate();
      return true;
    }

    const seedWorkflow = options?.workflowId
      ? workflows.find((workflow) => workflow.id === options.workflowId) ?? null
      : null;

    this._state = {
      appState: 'idle',
      originalQuery: query,
      workflows,
      seedWorkflow,
      pendingPrompt: null,
      entries: [],
      autoTriggered: options?.autoTriggered ?? !options?.manual,
      clarificationCount: 0,
    };
    this.onUpdate();
    return true;
  }

  handleWorkflowSelect(workflowId: string | null): void {
    if (!workflowId) {
      this.close();
      return;
    }

    const workflow = this._state.workflows.find((item) => item.id === workflowId) ?? null;
    this._state = {
      ...this._state,
      appState: 'idle',
      seedWorkflow: workflow,
    };
    this.onUpdate();
  }

  setPendingPrompt(prompt: GuidedQaPrompt): void {
    this._state = {
      ...this._state,
      pendingPrompt: prompt,
      appState: prompt.mode === 'single_select' ? 'structured_question' : 'idle',
    };
    this.onUpdate();
  }

  clearPendingPrompt(): void {
    this._state = {
      ...this._state,
      pendingPrompt: null,
      appState: 'idle',
    };
    this.onUpdate();
  }

  recordInlineAnswer(answer: string): void {
    const prompt = this._state.pendingPrompt;
    if (!prompt) {
      return;
    }
    const value = answer.trim();
    if (!value) {
      return;
    }
    this._state = {
      ...this._state,
      entries: [
        ...this._state.entries,
        {
          label: prompt.label ?? 'Clarification',
          value,
        },
      ],
      pendingPrompt: null,
      appState: 'idle',
      clarificationCount: this._state.clarificationCount + 1,
    };
    this.onUpdate();
  }

  recordStructuredAnswer(value: string | null): void {
    const prompt = this._state.pendingPrompt;
    if (!prompt || !value) {
      this.clearPendingPrompt();
      return;
    }

    this._state = {
      ...this._state,
      entries: [
        ...this._state.entries,
        {
          label: prompt.label ?? 'Clarification',
          value: formatOptionValue(prompt.options, value),
        },
      ],
      pendingPrompt: null,
      appState: 'idle',
      clarificationCount: this._state.clarificationCount + 1,
    };
    this.onUpdate();
  }

  getClarificationCount(): number {
    return this._state.clarificationCount;
  }

  getSummaryEntries(): GuidedQaSummaryEntry[] {
    return [...this._state.entries];
  }

  getOriginalQuery(): string {
    return this._state.originalQuery;
  }

  getSeedWorkflow(): ProfileGuidedQaWorkflow | null {
    return this._state.seedWorkflow;
  }

  buildRunContext(): GuidedQaRunContext | null {
    const originalQuery = this._state.originalQuery.trim() || this._state.seedWorkflow?.label || '';
    if (!originalQuery) {
      return null;
    }

    return {
      originalQuery,
      enrichedQuery: buildGuidedQaPrompt({
        originalQuery,
        entries: this._state.entries,
        seedWorkflow: this._state.seedWorkflow,
      }),
      entries: [...this._state.entries],
      autoTriggered: this._state.autoTriggered,
      seedWorkflowId: this._state.seedWorkflow?.id,
      seedWorkflowLabel: this._state.seedWorkflow?.label,
    };
  }

  close(): void {
    this._state = {
      appState: 'idle',
      originalQuery: '',
      workflows: [],
      seedWorkflow: null,
      pendingPrompt: null,
      entries: [],
      autoTriggered: false,
      clarificationCount: 0,
    };
    this.onUpdate();
  }
}

export function formatGuidedQaOption(option: GuidedQaOption): string {
  return option.description ? `${option.label} · ${option.description}` : option.label;
}
