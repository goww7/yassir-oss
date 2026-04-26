import { callLlm } from '../model/llm.js';
import { getFastModel } from '../model/llm.js';
import { resolveProvider } from '../providers.js';
import type { ScratchpadEntry } from './scratchpad.js';

/**
 * An indexed summary of a cleared tool result that can be retrieved later.
 */
export interface ClearedResultSummary {
  /** Original tool name */
  toolName: string;
  /** Original tool arguments */
  args: Record<string, unknown>;
  /** Compressed summary of the result */
  summary: string;
  /** Index in the scratchpad (for deduplication) */
  originalIndex: number;
}

/**
 * Manages summaries of cleared scratchpad entries for retrieval.
 * When tool results are evicted from context, this stores compressed summaries
 * that can be recalled when they become relevant to the current iteration.
 */
export class ScratchpadRetriever {
  private readonly summaries: ClearedResultSummary[] = [];
  private readonly indexedIndices: Set<number> = new Set();

  /**
   * Index cleared entries by generating compressed summaries.
   * Uses the fast model to summarize each cleared tool result.
   */
  async indexClearedEntries(
    entries: ScratchpadEntry[],
    clearedIndices: number[],
    model: string,
    signal?: AbortSignal,
  ): Promise<void> {
    // Only index entries we haven't already indexed
    const newIndices = clearedIndices.filter(i => !this.indexedIndices.has(i));
    if (newIndices.length === 0) return;

    const toolEntries = entries.filter(e => e.type === 'tool_result' && e.toolName);

    for (const index of newIndices) {
      const entry = toolEntries[index];
      if (!entry || !entry.toolName) continue;

      const summary = await this.summarizeEntry(entry, model, signal);
      this.summaries.push({
        toolName: entry.toolName,
        args: entry.args ?? {},
        summary,
        originalIndex: index,
      });
      this.indexedIndices.add(index);
    }
  }

  /**
   * Retrieve summaries relevant to the current query context.
   * Uses keyword matching against the query to find relevant cleared results.
   */
  retrieveRelevant(query: string, maxResults: number = 3): ClearedResultSummary[] {
    if (this.summaries.length === 0) return [];

    // Score each summary by keyword overlap with the query
    const queryWords = new Set(
      query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2)
    );

    const scored = this.summaries.map(summary => {
      const summaryWords = new Set(
        `${summary.toolName} ${Object.values(summary.args).join(' ')} ${summary.summary}`
          .toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 2)
      );

      const overlap = [...queryWords].filter(w => summaryWords.has(w)).length;
      const score = queryWords.size > 0 ? overlap / queryWords.size : 0;
      return { summary, score };
    });

    return scored
      .filter(s => s.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(s => s.summary);
  }

  /**
   * Format retrieved summaries for injection into the iteration prompt.
   */
  formatForPrompt(query: string): string {
    const relevant = this.retrieveRelevant(query);
    if (relevant.length === 0) return '';

    const lines = relevant.map(s => {
      const argsStr = Object.entries(s.args).map(([k, v]) => `${k}=${v}`).join(', ');
      return `- **${s.toolName}**(${argsStr}): ${s.summary}`;
    });

    return `## Previously Retrieved Data (summaries of cleared context)

The following tool results were retrieved earlier but cleared from full context to save space. Use these summaries as reference:

${lines.join('\n')}`;
  }

  get summaryCount(): number {
    return this.summaries.length;
  }

  /**
   * Summarize a single tool result entry using the fast model.
   * Falls back to truncation if LLM call fails.
   */
  private async summarizeEntry(
    entry: ScratchpadEntry,
    model: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const resultStr = typeof entry.result === 'string'
      ? entry.result
      : JSON.stringify(entry.result);

    // For short results, no need to summarize
    if (resultStr.length < 500) {
      return resultStr.slice(0, 400);
    }

    const provider = resolveProvider(model);
    const fastModel = getFastModel(provider.id, model);

    try {
      const result = await callLlm(
        `Summarize the key data points from this tool result in 2-3 sentences. Focus on numbers, facts, and findings. Be specific.\n\nTool: ${entry.toolName}\nResult:\n${resultStr.slice(0, 4000)}`,
        {
          model: fastModel,
          systemPrompt: 'You are a data summarization assistant. Output only the summary, nothing else.',
          signal,
        },
      );

      const text = typeof result.response === 'string'
        ? result.response
        : (result.response as { content: string }).content ?? '';

      return text.trim().slice(0, 500);
    } catch {
      // Fallback: extract first meaningful chunk
      return resultStr.slice(0, 400) + '...';
    }
  }
}
