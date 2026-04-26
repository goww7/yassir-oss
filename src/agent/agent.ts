import { AIMessage } from '@langchain/core/messages';
import { StructuredToolInterface } from '@langchain/core/tools';
import { callLlm } from '../model/llm.js';
import { getTools } from '../tools/registry.js';
import { buildSystemPrompt, buildIterationPrompt, loadSoulDocument } from './prompts.js';
import { generateResearchPlan, formatPlanForPrompt, type ResearchPlan } from './research-plan.js';
import { ScratchpadRetriever } from './scratchpad-retrieval.js';
import { ProgressSynthesizer } from './progress-synthesis.js';
import { extractTextContent, hasToolCalls } from '../utils/ai-message.js';
import { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';
import { buildHistoryContext } from '../utils/history-context.js';
import { estimateTokens } from '../utils/tokens.js';
import { formatUserFacingError, isContextOverflowError } from '../utils/errors.js';
import type { AgentConfig, AgentEvent, ContextClearedEvent, TokenUsage } from '../agent/types.js';
import { createRunContext, type RunContext } from './run-context.js';
import { AgentToolExecutor } from './tool-executor.js';
import { MemoryManager } from '../memory/index.js';
import { runMemoryFlush, shouldRunMemoryFlush } from '../memory/flush.js';
import { resolveProvider } from '../providers.js';
import {
  DEFAULT_MODEL,
  DEFAULT_MAX_ITERATIONS,
  MAX_OVERFLOW_RETRIES,
  OVERFLOW_KEEP_TOOL_USES,
  CONTEXT_THRESHOLD,
  KEEP_TOOL_USES,
} from '../config.js';

function parseClarificationRequest(responseText: string): { question: string } | null {
  const trimmed = responseText.trim();
  const prefix = 'CLARIFICATION_NEEDED:';
  if (!trimmed.startsWith(prefix)) {
    return null;
  }
  const question = trimmed.slice(prefix.length).trim();
  return question ? { question } : null;
}

/**
 * The core agent class that handles the agent loop and tool execution.
 */
export class Agent {
  private readonly model: string;
  private readonly maxIterations: number;
  private readonly tools: StructuredToolInterface[];
  private readonly toolMap: Map<string, StructuredToolInterface>;
  private readonly toolExecutor: AgentToolExecutor;
  private readonly systemPrompt: string;
  private readonly signal?: AbortSignal;
  private readonly memoryEnabled: boolean;

  private constructor(
    config: AgentConfig,
    tools: StructuredToolInterface[],
    systemPrompt: string,
  ) {
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.tools = tools;
    this.toolMap = new Map(tools.map(t => [t.name, t]));
    this.toolExecutor = new AgentToolExecutor(this.toolMap, config.signal, config.requestToolApproval, config.sessionApprovedTools);
    this.systemPrompt = systemPrompt;
    this.signal = config.signal;
    this.memoryEnabled = config.memoryEnabled ?? true;
  }

  /**
   * Create a new Agent instance with tools.
   */
  static async create(config: AgentConfig = {}): Promise<Agent> {
    const model = config.model ?? DEFAULT_MODEL;
    const tools = getTools(model);
    const soulContent = await loadSoulDocument();
    let memoryFiles: string[] = [];

    if (config.memoryEnabled !== false) {
      const memoryManager = await MemoryManager.get();
      memoryFiles = await memoryManager.listFiles();
    }

    const systemPrompt = buildSystemPrompt(
      model,
      soulContent,
      config.channel,
      config.groupContext,
      memoryFiles,
    );
    return new Agent(config, tools, systemPrompt);
  }

  /**
   * Run the agent and yield events for real-time UI updates.
   * Anthropic-style context management: full tool results during iteration,
   * with threshold-based clearing of oldest results when context exceeds limit.
   */
  async *run(query: string, inMemoryHistory?: InMemoryChatHistory): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();

    if (this.tools.length === 0) {
      yield { type: 'done', answer: 'No tools available. Please check your API key configuration.', toolCalls: [], iterations: 0, totalTime: Date.now() - startTime };
      return;
    }

    const ctx = createRunContext(query);
    const memoryFlushState = { alreadyFlushed: false };
    const retriever = new ScratchpadRetriever();
    const synthesizer = new ProgressSynthesizer();

    // Planning pre-pass: decompose complex queries into a research plan
    const plan = await generateResearchPlan(query, this.model, this.signal);
    if (plan.usage) {
      ctx.tokenCounter.add(plan.usage);
    }
    if (plan.needsPlan) {
      yield { type: 'thinking', message: `Research plan:\n${plan.planText}` };
    }

    // Build initial prompt with conversation history context
    let currentPrompt = this.buildInitialPrompt(query, inMemoryHistory, plan);

    // Main agent loop
    let overflowRetries = 0;
    while (ctx.iteration < this.maxIterations) {
      ctx.iteration++;

      let response: AIMessage | string;
      let usage: TokenUsage | undefined;

      while (true) {
        try {
          const result = await this.callModel(currentPrompt);
          response = result.response;
          usage = result.usage;
          overflowRetries = 0;
          break;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (isContextOverflowError(errorMessage) && overflowRetries < MAX_OVERFLOW_RETRIES) {
            overflowRetries++;
            const clearedCount = ctx.scratchpad.clearOldestToolResults(OVERFLOW_KEEP_TOOL_USES);

            if (clearedCount > 0) {
              yield { type: 'context_cleared', clearedCount, keptCount: OVERFLOW_KEEP_TOOL_USES };
              currentPrompt = buildIterationPrompt(
                query,
                ctx.scratchpad.getToolResults(),
                ctx.scratchpad.formatToolUsageForPrompt(),
                formatPlanForPrompt(plan),
              );
              continue;
            }
          }

          const totalTime = Date.now() - ctx.startTime;
          const provider = resolveProvider(this.model).displayName;
          yield {
            type: 'done',
            answer: `Error: ${formatUserFacingError(errorMessage, provider)}`,
            toolCalls: ctx.scratchpad.getToolCallRecords(),
            iterations: ctx.iteration,
            totalTime,
            tokenUsage: ctx.tokenCounter.getUsage(),
            tokensPerSecond: ctx.tokenCounter.getTokensPerSecond(totalTime),
          };
          return;
        }
      }

      ctx.tokenCounter.add(usage);
      const responseText = typeof response === 'string' ? response : extractTextContent(response);

      // Emit thinking if there are also tool calls (skip whitespace-only responses)
      if (responseText?.trim() && typeof response !== 'string' && hasToolCalls(response)) {
        const trimmedText = responseText.trim();
        ctx.scratchpad.addThinking(trimmedText);
        yield { type: 'thinking', message: trimmedText };
      }

      // No tool calls = final answer is in this response
      if (typeof response === 'string' || !hasToolCalls(response)) {
        const clarification = parseClarificationRequest(responseText ?? '');
        if (clarification) {
          yield {
            type: 'clarification_needed',
            question: clarification.question,
            mode: 'inline',
          };
          return;
        }
        yield* this.handleDirectResponse(responseText ?? '', ctx);
        return;
      }

      // Execute tools and add results to scratchpad (response is AIMessage here)
      let shouldSynthesize = false;
      for await (const event of this.toolExecutor.executeAll(response, ctx)) {
        yield event;
        if (event.type === 'tool_denied') {
          const totalTime = Date.now() - ctx.startTime;
          yield {
            type: 'done',
            answer: '',
            toolCalls: ctx.scratchpad.getToolCallRecords(),
            iterations: ctx.iteration,
            totalTime,
            tokenUsage: ctx.tokenCounter.getUsage(),
            tokensPerSecond: ctx.tokenCounter.getTokensPerSecond(totalTime),
          };
          return;
        }
        if (event.type === 'tool_end') {
          if (synthesizer.recordToolCall()) {
            shouldSynthesize = true;
          }
        }
      }

      // Emit progress synthesis after every N tool calls
      if (shouldSynthesize) {
        yield* this.emitProgressSynthesis(synthesizer, ctx, query);
      }

      yield* this.manageContextThreshold(ctx, query, memoryFlushState, retriever);

      // Build iteration prompt with full tool results (Anthropic-style)
      const retrievedContext = retriever.summaryCount > 0
        ? retriever.formatForPrompt(query)
        : '';
      currentPrompt = buildIterationPrompt(
        query,
        ctx.scratchpad.getToolResults(),
        ctx.scratchpad.formatToolUsageForPrompt(),
        formatPlanForPrompt(plan),
        retrievedContext,
      );
    }

    // Max iterations reached with no final response
    const totalTime = Date.now() - ctx.startTime;
    yield {
      type: 'done',
      answer: `Reached maximum iterations (${this.maxIterations}). I was unable to complete the research in the allotted steps.`,
      toolCalls: ctx.scratchpad.getToolCallRecords(),
      iterations: ctx.iteration,
      totalTime,
      tokenUsage: ctx.tokenCounter.getUsage(),
      tokensPerSecond: ctx.tokenCounter.getTokensPerSecond(totalTime),
    };
  }

  /**
   * Call the LLM with the current prompt.
   * @param prompt - The prompt to send to the LLM
   * @param useTools - Whether to bind tools (default: true). When false, returns string directly.
   */
  private async callModel(prompt: string, useTools: boolean = true): Promise<{ response: AIMessage | string; usage?: TokenUsage }> {
    const result = await callLlm(prompt, {
      model: this.model,
      systemPrompt: this.systemPrompt,
      tools: useTools ? this.tools : undefined,
      signal: this.signal,
    });
    return { response: result.response, usage: result.usage };
  }

  /**
   * Emit the response text as the final answer.
   */
  private async *handleDirectResponse(
    responseText: string,
    ctx: RunContext
  ): AsyncGenerator<AgentEvent, void> {
    const totalTime = Date.now() - ctx.startTime;
    yield {
      type: 'done',
      answer: responseText,
      toolCalls: ctx.scratchpad.getToolCallRecords(),
      iterations: ctx.iteration,
      totalTime,
      tokenUsage: ctx.tokenCounter.getUsage(),
      tokensPerSecond: ctx.tokenCounter.getTokensPerSecond(totalTime),
    };
  }

  /**
   * Emit a progress synthesis if enough tool calls have accumulated.
   */
  private async *emitProgressSynthesis(
    synthesizer: ProgressSynthesizer,
    ctx: RunContext,
    query: string,
  ): AsyncGenerator<AgentEvent, void> {
    const synthesis = await synthesizer.synthesize(
      query,
      ctx.scratchpad.getToolResults(),
      this.model,
      this.signal,
    );
    if (synthesis) {
      yield { type: 'thinking', message: synthesis };
    }
  }

  /**
   * Clear oldest tool results if context size exceeds threshold.
   * Indexes cleared results into the retriever for later recall.
   */
  private async *manageContextThreshold(
    ctx: RunContext,
    query: string,
    memoryFlushState: { alreadyFlushed: boolean },
    retriever?: ScratchpadRetriever,
  ): AsyncGenerator<ContextClearedEvent | AgentEvent, void> {
    const fullToolResults = ctx.scratchpad.getToolResults();
    const estimatedContextTokens = estimateTokens(this.systemPrompt + ctx.query + fullToolResults);

    if (estimatedContextTokens > CONTEXT_THRESHOLD) {
      if (
        this.memoryEnabled &&
        shouldRunMemoryFlush({
          estimatedContextTokens,
          alreadyFlushed: memoryFlushState.alreadyFlushed,
        })
      ) {
        yield { type: 'memory_flush', phase: 'start' };
        const flushResult = await runMemoryFlush({
          model: this.model,
          systemPrompt: this.systemPrompt,
          query,
          toolResults: fullToolResults,
          signal: this.signal,
        }).catch(() => ({ flushed: false, written: false as const }));
        memoryFlushState.alreadyFlushed = flushResult.flushed;
        yield {
          type: 'memory_flush',
          phase: 'end',
          filesWritten: flushResult.written ? [`${new Date().toISOString().slice(0, 10)}.md`] : [],
        };
      }

      const previouslyClearedIndices = [...ctx.scratchpad.getClearedIndices()];
      const clearedCount = ctx.scratchpad.clearOldestToolResults(KEEP_TOOL_USES);
      if (clearedCount > 0) {
        memoryFlushState.alreadyFlushed = false;
        yield { type: 'context_cleared', clearedCount, keptCount: KEEP_TOOL_USES };

        // Index newly cleared entries for retrieval
        if (retriever) {
          const newlyClearedIndices = [...ctx.scratchpad.getClearedIndices()]
            .filter(i => !previouslyClearedIndices.includes(i));
          await retriever.indexClearedEntries(
            ctx.scratchpad.getAllEntries(),
            newlyClearedIndices,
            this.model,
            this.signal,
          ).catch(() => { /* non-fatal */ });
        }
      }
    }
  }

  /**
   * Build initial prompt with conversation history context and research plan
   */
  private buildInitialPrompt(
    query: string,
    inMemoryChatHistory?: InMemoryChatHistory,
    plan?: ResearchPlan,
  ): string {
    let prompt: string;

    if (inMemoryChatHistory?.hasMessages()) {
      const recentTurns = inMemoryChatHistory.getRecentTurns();
      prompt = recentTurns.length > 0
        ? buildHistoryContext({ entries: recentTurns, currentMessage: query })
        : query;
    } else {
      prompt = query;
    }

    // Inject research plan into the initial prompt
    if (plan?.needsPlan) {
      prompt += `\n\n${formatPlanForPrompt(plan)}`;
    }

    return prompt;
  }
}
