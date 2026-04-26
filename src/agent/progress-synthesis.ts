import { callLlm } from '../model/llm.js';
import { getFastModel } from '../model/llm.js';
import { resolveProvider } from '../providers.js';

/**
 * Tracks tool call count and emits periodic progress syntheses.
 * Gives the user visibility into what the agent has found so far.
 */
export class ProgressSynthesizer {
  private toolCallsSinceLastSynthesis = 0;
  private totalToolCalls = 0;
  private lastSynthesis = '';

  constructor(
    private readonly interval: number = 4,
  ) {}

  /**
   * Record a tool call. Returns true if a synthesis should be emitted.
   */
  recordToolCall(): boolean {
    this.toolCallsSinceLastSynthesis++;
    this.totalToolCalls++;
    return this.toolCallsSinceLastSynthesis >= this.interval;
  }

  /**
   * Generate a brief progress synthesis based on current tool results.
   * Uses the fast model to keep latency low.
   */
  async synthesize(
    query: string,
    toolResults: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (!toolResults.trim()) return null;

    const provider = resolveProvider(model);
    const fastModel = getFastModel(provider.id, model);

    try {
      const result = await callLlm(
        `User query: ${query}\n\nData gathered so far:\n${toolResults.slice(0, 6000)}\n\nWrite a 1-2 sentence progress update of what you've found so far. Be specific about data points. Start with "So far:" and be concise.`,
        {
          model: fastModel,
          systemPrompt: 'You are a research progress reporter. Output only the brief progress update, nothing else. Keep it under 100 words.',
          signal,
        },
      );

      const text = typeof result.response === 'string'
        ? result.response
        : (result.response as { content: string }).content ?? '';

      const synthesis = text.trim();
      if (synthesis && synthesis !== this.lastSynthesis) {
        this.lastSynthesis = synthesis;
        this.toolCallsSinceLastSynthesis = 0;
        return synthesis;
      }

      return null;
    } catch {
      // Non-fatal — skip this synthesis
      this.toolCallsSinceLastSynthesis = 0;
      return null;
    }
  }
}
