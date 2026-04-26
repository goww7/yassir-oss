import { AIMessage } from '@langchain/core/messages';
import { StructuredToolInterface } from '@langchain/core/tools';
import { createProgressChannel } from '../utils/progress-channel.js';
import type {
  ApprovalDecision,
  ToolApprovalEvent,
  ToolDeniedEvent,
  ToolEndEvent,
  ToolErrorEvent,
  ToolLimitEvent,
  ToolProgressEvent,
  ToolStartEvent,
} from './types.js';
import type { RunContext } from './run-context.js';

type ToolExecutionEvent =
  | ToolStartEvent
  | ToolProgressEvent
  | ToolEndEvent
  | ToolErrorEvent
  | ToolApprovalEvent
  | ToolDeniedEvent
  | ToolLimitEvent;

export const TOOLS_REQUIRING_APPROVAL = [
  'write_file',
  'edit_file',
  'screen_index_bulk',
  'cancel_bulk_run',
  'delete_bulk_run',
  'create_watchlist',
  'delete_watchlist',
  'add_watchlist_symbol',
  'remove_watchlist_symbol',
  'create_checkout',
  'regenerate_key',
] as const;

/**
 * Executes tool calls and emits streaming tool lifecycle events.
 */
export class AgentToolExecutor {
  private readonly sessionApprovedTools: Set<string>;

  constructor(
    private readonly toolMap: Map<string, StructuredToolInterface>,
    private readonly signal?: AbortSignal,
    private readonly requestToolApproval?: (request: {
      tool: string;
      args: Record<string, unknown>;
    }) => Promise<ApprovalDecision>,
    sessionApprovedTools?: Set<string>,
  ) {
    this.sessionApprovedTools = sessionApprovedTools ?? new Set();
  }

  async *executeAll(
    response: AIMessage,
    ctx: RunContext
  ): AsyncGenerator<ToolExecutionEvent, void> {
    const blockedToolsThisTurn = new Set<string>();

    // Separate tool calls into those requiring approval (must be sequential)
    // and independent calls that can run in parallel
    const toolCalls = (response.tool_calls ?? []).map(tc => ({
      name: tc.name,
      args: tc.args as Record<string, unknown>,
    }));

    // Filter and deduplicate
    const eligible: Array<{ name: string; args: Record<string, unknown> }> = [];
    for (const tc of toolCalls) {
      if (blockedToolsThisTurn.has(tc.name)) continue;
      if (tc.name === 'skill') {
        const skillName = tc.args.skill as string;
        if (ctx.scratchpad.hasExecutedSkill(skillName)) continue;
      }
      eligible.push(tc);
    }

    // Split: approval-requiring tools run sequentially, others can be parallelized
    const sequential: typeof eligible = [];
    const parallelizable: typeof eligible = [];

    for (const tc of eligible) {
      if (this.requiresApproval(tc.name) && !this.sessionApprovedTools.has(tc.name)) {
        sequential.push(tc);
      } else {
        parallelizable.push(tc);
      }
    }

    // Execute approval-requiring tools first (must be sequential for user interaction)
    for (const tc of sequential) {
      yield* this.executeSingle(tc.name, tc.args, ctx);
      const postCheck = ctx.scratchpad.canCallTool(tc.name, this.extractQueryFromArgs(tc.args));
      if (!postCheck.allowed) {
        blockedToolsThisTurn.add(tc.name);
      }
    }

    // Execute independent tools in parallel, collecting events
    if (parallelizable.length > 1) {
      yield* this.executeParallel(parallelizable, ctx, blockedToolsThisTurn);
    } else if (parallelizable.length === 1) {
      const tc = parallelizable[0];
      yield* this.executeSingle(tc.name, tc.args, ctx);
      const postCheck = ctx.scratchpad.canCallTool(tc.name, this.extractQueryFromArgs(tc.args));
      if (!postCheck.allowed) {
        blockedToolsThisTurn.add(tc.name);
      }
    }
  }

  /**
   * Execute multiple independent tool calls in parallel.
   * Collects all events and yields them in order of completion.
   */
  private async *executeParallel(
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
    ctx: RunContext,
    blockedToolsThisTurn: Set<string>,
  ): AsyncGenerator<ToolExecutionEvent, void> {
    // Collect events from each parallel execution
    const allEvents: Array<{ index: number; events: ToolExecutionEvent[] }> = [];

    const promises = toolCalls.map(async (tc, index) => {
      const events: ToolExecutionEvent[] = [];
      for await (const event of this.executeSingle(tc.name, tc.args, ctx)) {
        events.push(event);
      }
      return { index, events };
    });

    // Wait for all to complete, yield events as each finishes
    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { index, events } = result.value;
        for (const event of events) {
          yield event;
        }
        // Check post-execution limits
        const tc = toolCalls[index];
        const postCheck = ctx.scratchpad.canCallTool(tc.name, this.extractQueryFromArgs(tc.args));
        if (!postCheck.allowed) {
          blockedToolsThisTurn.add(tc.name);
        }
      }
    }
  }

  private async *executeSingle(
    toolName: string,
    toolArgs: Record<string, unknown>,
    ctx: RunContext
  ): AsyncGenerator<ToolExecutionEvent, void> {
    const toolQuery = this.extractQueryFromArgs(toolArgs);

    if (this.requiresApproval(toolName) && !this.sessionApprovedTools.has(toolName)) {
      const decision = (await this.requestToolApproval?.({ tool: toolName, args: toolArgs })) ?? 'deny';
      yield { type: 'tool_approval', tool: toolName, args: toolArgs, approved: decision };
      if (decision === 'deny') {
        yield { type: 'tool_denied', tool: toolName, args: toolArgs };
        return;
      }
      if (decision === 'allow-session') {
        this.sessionApprovedTools.add(toolName);
      }
    }

    const limitCheck = ctx.scratchpad.canCallTool(toolName, toolQuery);

    if (limitCheck.warning) {
      yield {
        type: 'tool_limit',
        tool: toolName,
        warning: limitCheck.warning,
        blocked: !limitCheck.allowed,
      };
    }

    if (!limitCheck.allowed) {
      const message = limitCheck.warning ?? `Skipped '${toolName}' due to previous failures in this query`;
      yield { type: 'tool_error', tool: toolName, error: message };
      ctx.scratchpad.addToolResult(toolName, toolArgs, `Error: ${message}`);
      return;
    }

    yield { type: 'tool_start', tool: toolName, args: toolArgs };

    const toolStartTime = Date.now();

    try {
      const tool = this.toolMap.get(toolName);
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found`);
      }

      // Create a progress channel so subagent tools can stream status updates
      const channel = createProgressChannel();
      const config = {
        metadata: { onProgress: channel.emit },
        ...(this.signal ? { signal: this.signal } : {}),
      };

      // Launch tool invocation -- closes the channel when it settles
      const toolPromise = tool.invoke(toolArgs, config).then(
        (raw) => {
          channel.close();
          return raw;
        },
        (err) => {
          channel.close();
          throw err;
        }
      );

      // Drain progress events in real-time as the tool executes
      for await (const message of channel) {
        yield { type: 'tool_progress', tool: toolName, message } as ToolProgressEvent;
      }

      // Tool has finished -- collect the result
      const rawResult = await toolPromise;
      const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
      const duration = Date.now() - toolStartTime;

      yield { type: 'tool_end', tool: toolName, args: toolArgs, result, duration };

      // Record the tool call for limit tracking
      ctx.scratchpad.recordToolCall(toolName, toolQuery);

      // Add full tool result to scratchpad (Anthropic-style: no inline summarization)
      ctx.scratchpad.addToolResult(toolName, toolArgs, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield { type: 'tool_error', tool: toolName, error: errorMessage };

      // Still record the call even on error (counts toward limit)
      ctx.scratchpad.recordToolCall(toolName, toolQuery);

      // Add error to scratchpad
      ctx.scratchpad.addToolResult(toolName, toolArgs, `Error: ${errorMessage}`);
    }
  }

  private extractQueryFromArgs(args: Record<string, unknown>): string | undefined {
    const queryKeys = ['query', 'search', 'question', 'q', 'text', 'input'];

    for (const key of queryKeys) {
      if (typeof args[key] === 'string') {
        return args[key] as string;
      }
    }

    return undefined;
  }

  private requiresApproval(toolName: string): boolean {
    return (TOOLS_REQUIRING_APPROVAL as readonly string[]).includes(toolName);
  }
}
