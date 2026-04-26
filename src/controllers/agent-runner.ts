import { Agent } from '../agent/agent.js';
import type { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';
import type {
  AgentConfig,
  AgentEvent,
  ApprovalDecision,
  ClarificationNeededEvent,
  DoneEvent,
} from '../agent/index.js';
import type { DisplayEvent } from '../agent/types.js';
import type { GuidedQaRunContext } from './guided-qa-controller.js';
import type { HistoryItem, HistoryItemStatus, WorkingState } from '../types.js';

type ChangeListener = () => void;

export interface RunQueryResult {
  answer: string;
}

export interface RunQueryOptions {
  displayQuery?: string;
  clarificationContext?: Omit<GuidedQaRunContext, 'enrichedQuery'>;
  reusePendingClarification?: boolean;
  historyQuery?: string;
}

export class AgentRunnerController {
  private historyValue: HistoryItem[] = [];
  private workingStateValue: WorkingState = { status: 'idle' };
  private errorValue: string | null = null;
  private pendingApprovalValue: { tool: string; args: Record<string, unknown> } | null = null;
  private readonly agentConfig: AgentConfig;
  private readonly inMemoryChatHistory: InMemoryChatHistory;
  private readonly onChange?: ChangeListener;
  private abortController: AbortController | null = null;
  private approvalResolve: ((decision: ApprovalDecision) => void) | null = null;
  private sessionApprovedTools = new Set<string>();

  constructor(
    agentConfig: AgentConfig,
    inMemoryChatHistory: InMemoryChatHistory,
    onChange?: ChangeListener,
  ) {
    this.agentConfig = agentConfig;
    this.inMemoryChatHistory = inMemoryChatHistory;
    this.onChange = onChange;
  }

  get history(): HistoryItem[] {
    return this.historyValue;
  }

  get workingState(): WorkingState {
    return this.workingStateValue;
  }

  get error(): string | null {
    return this.errorValue;
  }

  get pendingApproval(): { tool: string; args: Record<string, unknown> } | null {
    return this.pendingApprovalValue;
  }

  get isProcessing(): boolean {
    return (
      this.historyValue.length > 0 && this.historyValue[this.historyValue.length - 1]?.status === 'processing'
    );
  }

  setError(error: string | null) {
    this.errorValue = error;
    this.emitChange();
  }

  respondToApproval(decision: ApprovalDecision) {
    if (!this.approvalResolve) {
      return;
    }
    this.approvalResolve(decision);
    this.approvalResolve = null;
    this.pendingApprovalValue = null;
    if (decision !== 'deny') {
      this.workingStateValue = { status: 'thinking' };
    }
    this.emitChange();
  }

  cancelExecution() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.approvalResolve) {
      this.approvalResolve('deny');
      this.approvalResolve = null;
      this.pendingApprovalValue = null;
    }
    this.markLastProcessing('interrupted');
    this.workingStateValue = { status: 'idle' };
    this.emitChange();
  }

  async runQuery(query: string, options?: RunQueryOptions): Promise<RunQueryResult | undefined> {
    this.abortController = new AbortController();
    let finalAnswer: string | undefined;

    const startTime = Date.now();
    const displayQuery = options?.displayQuery ?? query;
    const historyQuery = options?.historyQuery ?? displayQuery;
    const reusePending =
      options?.reusePendingClarification &&
      this.historyValue[this.historyValue.length - 1]?.status === 'awaiting_clarification';

    if (reusePending) {
      const last = this.historyValue[this.historyValue.length - 1]!;
      this.historyValue = [
        ...this.historyValue.slice(0, -1),
        {
          ...last,
          status: 'processing',
          clarificationContext: options?.clarificationContext ?? last.clarificationContext,
          startTime,
        },
      ];
      if (!last.historySaved) {
        this.inMemoryChatHistory.saveUserQuery(historyQuery);
        this.updateLastHistorySaved(true);
      }
    } else {
      const item: HistoryItem = {
        id: String(startTime),
        query: displayQuery,
        events: [],
        answer: '',
        clarificationContext: options?.clarificationContext,
        status: 'processing',
        historySaved: true,
        startTime,
      };
      this.historyValue = [...this.historyValue, item];
      this.inMemoryChatHistory.saveUserQuery(historyQuery);
    }

    this.errorValue = null;
    this.workingStateValue = { status: 'thinking' };
    this.emitChange();

    try {
      const agent = await Agent.create({
        ...this.agentConfig,
        signal: this.abortController.signal,
        requestToolApproval: this.requestToolApproval,
        sessionApprovedTools: this.sessionApprovedTools,
      });
      const stream = agent.run(query, this.inMemoryChatHistory);
      for await (const event of stream) {
        if (event.type === 'done') {
          finalAnswer = (event as DoneEvent).answer;
        }
        await this.handleEvent(event);
      }
      if (finalAnswer) {
        return { answer: finalAnswer };
      }
      return undefined;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.markLastProcessing('interrupted');
        this.workingStateValue = { status: 'idle' };
        this.emitChange();
        return undefined;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.errorValue = message;
      this.markLastProcessing('error');
      this.workingStateValue = { status: 'idle' };
      this.emitChange();
      return undefined;
    } finally {
      this.abortController = null;
    }
  }

  addLocalAnswer(query: string, answer: string) {
    const startTime = Date.now();
    const item: HistoryItem = {
      id: `local-${startTime}`,
      query,
      events: [],
      answer,
      status: 'complete',
      historySaved: true,
      startTime,
      duration: 0,
    };
    this.historyValue = [...this.historyValue, item];
    this.inMemoryChatHistory.saveUserQuery(query);
    void this.inMemoryChatHistory.saveAnswer(answer).catch(() => {});
    this.errorValue = null;
    this.workingStateValue = { status: 'idle' };
    this.emitChange();
  }

  private requestToolApproval = (request: { tool: string; args: Record<string, unknown> }) => {
    return new Promise<ApprovalDecision>((resolve) => {
      this.approvalResolve = resolve;
      this.pendingApprovalValue = request;
      this.workingStateValue = { status: 'approval', toolName: request.tool };
      this.emitChange();
    });
  };

  private async handleEvent(event: AgentEvent) {
    switch (event.type) {
      case 'thinking':
        this.workingStateValue = { status: 'thinking', label: event.message };
        this.pushEvent({
          id: `thinking-${Date.now()}`,
          event,
          completed: true,
        });
        break;
      case 'tool_start': {
        const toolId = `tool-${event.tool}-${Date.now()}`;
        this.workingStateValue = { status: 'tool', toolName: event.tool };
        this.updateLastItem((last) => ({
          ...last,
          activeToolId: toolId,
          events: [
            ...last.events,
            {
              id: toolId,
              event,
              completed: false,
            } as DisplayEvent,
          ],
        }));
        break;
      }
      case 'tool_progress':
        if (this.workingStateValue.status === 'tool' && this.workingStateValue.toolName === event.tool) {
          this.workingStateValue = {
            ...this.workingStateValue,
            progressMessage: event.message,
          };
        }
        this.updateLastItem((last) => ({
          ...last,
          events: last.events.map((entry) =>
            entry.id === last.activeToolId ? { ...entry, progressMessage: event.message } : entry,
          ),
        }));
        break;
      case 'tool_end':
        this.finishToolEvent(event);
        this.workingStateValue = { status: 'thinking' };
        break;
      case 'tool_error':
        this.finishToolEvent(event);
        this.workingStateValue = { status: 'thinking' };
        break;
      case 'tool_approval':
        this.pushEvent({
          id: `approval-${event.tool}-${Date.now()}`,
          event,
          completed: true,
        });
        break;
      case 'tool_denied':
        this.pushEvent({
          id: `denied-${event.tool}-${Date.now()}`,
          event,
          completed: true,
        });
        break;
      case 'tool_limit':
      case 'context_cleared':
        this.pushEvent({
          id: `${event.type}-${Date.now()}`,
          event,
          completed: true,
        });
        break;
      case 'clarification_needed':
        this.pushEvent({
          id: `clarification-${Date.now()}`,
          event,
          completed: true,
        });
        this.markLastActiveStatus('awaiting_clarification');
        this.workingStateValue = { status: 'idle' };
        break;
      case 'done': {
        const done = event as DoneEvent;
        if (done.answer) {
          await this.inMemoryChatHistory.saveAnswer(done.answer).catch(() => {});
        }
        this.updateLastItem((last) => ({
          ...last,
          answer: done.answer,
          status: 'complete',
          duration: done.totalTime,
          tokenUsage: done.tokenUsage,
          tokensPerSecond: done.tokensPerSecond,
        }));
        this.workingStateValue = { status: 'idle' };
        break;
      }
    }
    this.emitChange();
  }

  private finishToolEvent(event: AgentEvent) {
    this.updateLastItem((last) => ({
      ...last,
      activeToolId: undefined,
      events: last.events.map((entry) =>
        entry.id === last.activeToolId ? { ...entry, completed: true, endEvent: event } : entry,
      ),
    }));
  }

  private pushEvent(displayEvent: DisplayEvent) {
    this.updateLastItem((last) => ({ ...last, events: [...last.events, displayEvent] }));
  }

  private updateLastItem(updater: (item: HistoryItem) => HistoryItem) {
    const last = this.historyValue[this.historyValue.length - 1];
    if (!last || (last.status !== 'processing' && last.status !== 'awaiting_clarification')) {
      return;
    }
    const next = updater(last);
    this.historyValue = [...this.historyValue.slice(0, -1), next];
  }

  showClarification(
    query: string,
    clarification: Omit<ClarificationNeededEvent, 'type'>,
    clarificationContext?: Omit<GuidedQaRunContext, 'enrichedQuery'>,
    options?: { reuseExisting?: boolean },
  ) {
    const event: ClarificationNeededEvent = { type: 'clarification_needed', ...clarification };
    if (options?.reuseExisting && this.historyValue[this.historyValue.length - 1]?.status === 'awaiting_clarification') {
      this.pushEvent({
        id: `clarification-${Date.now()}`,
        event,
        completed: true,
      });
      this.updateLastItem((last) => ({
        ...last,
        query,
        clarificationContext: clarificationContext ?? last.clarificationContext,
        status: 'awaiting_clarification',
      }));
      this.workingStateValue = { status: 'idle' };
      this.emitChange();
      return;
    }

    const item: HistoryItem = {
      id: `clarification-${Date.now()}`,
      query,
      events: [
        {
          id: `clarification-${Date.now()}`,
          event,
          completed: true,
        },
      ],
      answer: '',
      clarificationContext,
      status: 'awaiting_clarification',
      historySaved: false,
      startTime: Date.now(),
    };
    this.historyValue = [...this.historyValue, item];
    this.workingStateValue = { status: 'idle' };
    this.emitChange();
  }

  dismissPendingClarification() {
    const last = this.historyValue[this.historyValue.length - 1];
    if (!last || last.status !== 'awaiting_clarification') {
      return;
    }
    this.historyValue = [...this.historyValue.slice(0, -1), { ...last, status: 'interrupted' }];
    this.workingStateValue = { status: 'idle' };
    this.emitChange();
  }

  private markLastProcessing(status: HistoryItemStatus) {
    const last = this.historyValue[this.historyValue.length - 1];
    if (!last || last.status !== 'processing') {
      return;
    }
    this.historyValue = [...this.historyValue.slice(0, -1), { ...last, status }];
  }

  private markLastActiveStatus(status: HistoryItemStatus) {
    const last = this.historyValue[this.historyValue.length - 1];
    if (!last || (last.status !== 'processing' && last.status !== 'awaiting_clarification')) {
      return;
    }
    this.historyValue = [...this.historyValue.slice(0, -1), { ...last, status }];
  }

  private updateLastHistorySaved(historySaved: boolean) {
    const last = this.historyValue[this.historyValue.length - 1];
    if (!last) {
      return;
    }
    this.historyValue = [...this.historyValue.slice(0, -1), { ...last, historySaved }];
  }

  private emitChange() {
    this.onChange?.();
  }
}
