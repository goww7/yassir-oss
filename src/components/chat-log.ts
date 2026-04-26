import { Container, Spacer, Text, type TUI } from '@mariozechner/pi-tui';
import type { TokenUsage } from '../agent/types.js';
import type { GuidedQaSummaryEntry } from '../controllers/guided-qa-controller.js';
import { getCurrentProfile } from '../profile/current.js';
import { theme } from '../theme.js';
import type { SourceTraceEntry } from '../utils/source-trace.js';
import type { ToolSourceEntry } from '../utils/tool-source-drilldown.js';
import { AnswerBoxComponent } from './answer-box.js';
import { ToolEventComponent, formatToolPhase } from './tool-event.js';
import { UserQueryComponent } from './user-query.js';

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function truncateUrl(url: string, maxLen = 45): string {
  try {
    const parsed = new URL(url);
    const display = parsed.hostname + parsed.pathname;
    return display.length <= maxLen ? display : `${display.slice(0, maxLen)}...`;
  } catch {
    return url.length > maxLen ? `${url.slice(0, maxLen)}...` : url;
  }
}

function formatBrowserStep(args: Record<string, unknown>): string | null {
  const action = args.action as string | undefined;
  const url = args.url as string | undefined;
  switch (action) {
    case 'open':
      return `Opening ${truncateUrl(url || '')}`;
    case 'navigate':
      return `Navigating to ${truncateUrl(url || '')}`;
    case 'snapshot':
      return 'Reading page structure';
    case 'read':
      return 'Extracting page text';
    case 'close':
      return 'Closing browser';
    case 'act':
      return null;
    default:
      return null;
  }
}

interface ToolDisplayComponent {
  setActive(progressMessage?: string): void;
  setComplete(summary: string, duration: number): void;
  setError(error: string): void;
  setLimitWarning(warning?: string): void;
  setApproval(decision: 'allow-once' | 'allow-session' | 'deny'): void;
  setDenied(path: string, tool: string): void;
  setSources?(entries: ToolSourceEntry[]): void;
  hasSources?(): boolean;
  toggleSources?(): boolean;
}

class BrowserSessionComponent extends Container implements ToolDisplayComponent {
  private readonly tui: TUI;
  private readonly header: Text;
  private detail: Text | null = null;
  private currentStep: string | null = null;
  private activeMessage = 'Searching...';
  private activeSince: number | null = null;
  private activeTimer: Timer | null = null;

  constructor(tui: TUI, stepNumber: number) {
    super();
    this.tui = tui;
    this.addChild(new Spacer(1));
    this.header = new Text(
      `⏺ ${theme.muted(`Step ${String(stepNumber).padStart(2, '0')} · `)}${theme.primary(`${formatToolPhase('browser', String(stepNumber))} · `)}Browser`,
      0,
      0,
    );
    this.addChild(this.header);
  }

  setStep(args: Record<string, unknown>) {
    const step = formatBrowserStep(args);
    if (step) {
      this.currentStep = step;
    }
  }

  setActive(progressMessage?: string): void {
    if (!this.activeSince) {
      this.activeSince = Date.now();
    }
    this.activeMessage = progressMessage || this.currentStep || 'Searching...';
    this.ensureDetail();
    this.renderDetail();
    this.startTimer();
  }

  setComplete(summary: string, duration: number): void {
    this.clearDetail();
    const text = this.currentStep || `${summary}${theme.muted(` in ${formatDuration(duration)}`)}`;
    this.detail = new Text(`${theme.muted('⎿  ')}${text}`, 0, 0);
    this.addChild(this.detail);
  }

  setError(error: string): void {
    this.clearDetail();
    this.detail = new Text(`${theme.muted('⎿  ')}${theme.error(`Error: ${error}`)}`, 0, 0);
    this.addChild(this.detail);
  }

  setLimitWarning(warning?: string): void {
    this.clearDetail();
    this.detail = new Text(`${theme.muted('⎿  ')}${theme.warning(warning || 'Approaching suggested limit')}`, 0, 0);
    this.addChild(this.detail);
  }

  setApproval(decision: 'allow-once' | 'allow-session' | 'deny'): void {
    this.clearDetail();
    const label =
      decision === 'allow-once'
        ? 'Approved'
        : decision === 'allow-session'
          ? 'Approved (session)'
          : 'Denied';
    const color = decision === 'deny' ? theme.warning : theme.primary;
    this.detail = new Text(`${theme.muted('⎿  ')}${color(label)}`, 0, 0);
    this.addChild(this.detail);
  }

  setDenied(path: string, tool: string): void {
    this.clearDetail();
    const action = tool === 'write_file' ? 'write to' : tool === 'edit_file' ? 'edit of' : tool;
    this.detail = new Text(`${theme.muted('⎿  ')}${theme.warning(`User denied ${action} ${path}`)}`, 0, 0);
    this.addChild(this.detail);
  }

  private clearDetail() {
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    this.activeSince = null;
    if (this.detail) {
      this.removeChild(this.detail);
      this.detail = null;
    }
  }

  private ensureDetail() {
    if (!this.detail) {
      this.detail = new Text('', 0, 0);
      this.addChild(this.detail);
    }
  }

  private renderDetail() {
    if (!this.detail) return;
    const elapsed = this.activeSince ? theme.muted(` · ${formatDuration(Date.now() - this.activeSince)}`) : '';
    this.detail.setText(`${theme.muted('⎿  ')}${this.activeMessage}${elapsed}`);
  }

  private startTimer() {
    if (this.activeTimer) return;
    this.activeTimer = setInterval(() => {
      this.renderDetail();
      this.tui.requestRender();
    }, 250);
  }
}

export class ChatLogComponent extends Container {
  private readonly tui: TUI;
  private readonly toolById = new Map<string, ToolDisplayComponent>();
  private currentBrowserSession: BrowserSessionComponent | null = null;
  private activeAnswer: AnswerBoxComponent | null = null;
  private lastToolName: string | null = null;
  private lastToolComponent: ToolDisplayComponent | null = null;
  private lastSourceComponent: ToolDisplayComponent | null = null;
  private stepCounter = 0;

  constructor(tui: TUI) {
    super();
    this.tui = tui;
  }

  clearAll() {
    this.clear();
    this.toolById.clear();
    this.currentBrowserSession = null;
    this.activeAnswer = null;
    this.lastToolName = null;
    this.lastToolComponent = null;
    this.lastSourceComponent = null;
    this.stepCounter = 0;
  }

  addQuery(query: string) {
    this.addChild(new UserQueryComponent(query));
  }

  resetToolGrouping() {
    this.lastToolName = null;
    this.lastToolComponent = null;
    this.stepCounter = 0;
  }

  addInterrupted() {
    this.addChild(new Text(`${theme.muted(`⎿  Interrupted · What should ${getCurrentProfile().assistantName} do instead?`)}`, 0, 0));
  }

  addClarificationPrompt(
    question: string,
    options?: Array<{ value: string; label: string; description?: string }>,
  ) {
    this.addChild(new Spacer(1));
    this.addChild(new Text(`${theme.muted('✻ ')}${theme.primary('Clarification needed')}`, 0, 0));
    this.addChild(new Text(question, 0, 0));
    if (options && options.length > 0) {
      for (const [index, option] of options.entries()) {
        this.addChild(
          new Text(
            `${theme.muted('  - ')}${index + 1}. ${option.label}${
              option.description ? theme.muted(` · ${option.description}`) : ''
            }`,
            0,
            0,
          ),
        );
      }
    }
  }

  addGuidedQaSummary(workflowLabel: string, entries: GuidedQaSummaryEntry[], autoTriggered: boolean) {
    if (entries.length === 0) {
      return;
    }
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(
        `${theme.muted('✻ ')}${theme.primary('Q&A context used')}${theme.muted(
          ` · ${workflowLabel}${autoTriggered ? ' · auto' : ''}`,
        )}`,
        0,
        0,
      ),
    );
    for (const entry of entries) {
      this.addChild(
        new Text(`${theme.muted('  - ')}${entry.label}${theme.muted(' · ')}${theme.muted(entry.value)}`, 0, 0),
      );
    }
  }

  startTool(toolCallId: string, toolName: string, args: Record<string, unknown>, sourceReason?: string) {
    if (toolName !== 'browser') {
      this.currentBrowserSession = null;
    }

    const existing = this.toolById.get(toolCallId);
    if (existing) {
      existing.setActive();
      return existing;
    }

    if (toolName === 'browser') {
      if (!this.currentBrowserSession) {
        this.currentBrowserSession = new BrowserSessionComponent(this.tui, ++this.stepCounter);
        this.addChild(this.currentBrowserSession);
      }
      this.currentBrowserSession.setStep(args);
      this.currentBrowserSession.setActive();
      this.toolById.set(toolCallId, this.currentBrowserSession);
      this.lastToolName = null;
      this.lastToolComponent = null;
      return this.currentBrowserSession;
    }

    if (this.lastToolName === toolName && this.lastToolComponent) {
      this.lastToolComponent.setActive();
      this.toolById.set(toolCallId, this.lastToolComponent);
      return this.lastToolComponent;
    }

    const component = new ToolEventComponent(this.tui, ++this.stepCounter, toolName, args, sourceReason);
    component.setActive();
    this.toolById.set(toolCallId, component);
    this.addChild(component);
    this.lastToolName = toolName;
    this.lastToolComponent = component;
    return component;
  }

  updateToolProgress(toolCallId: string, message: string) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    existing.setActive(message);
  }

  completeTool(toolCallId: string, summary: string, duration: number) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    existing.setComplete(summary, duration);
    if (existing.hasSources?.()) {
      this.lastSourceComponent = existing;
    }
  }

  errorTool(toolCallId: string, error: string) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    existing.setError(error);
  }

  limitTool(toolCallId: string, warning?: string) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    existing.setLimitWarning(warning);
  }

  approveTool(toolCallId: string, decision: 'allow-once' | 'allow-session' | 'deny') {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    existing.setApproval(decision);
  }

  denyTool(toolCallId: string, path: string, tool: string) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    existing.setDenied(path, tool);
  }

  finalizeAnswer(text: string) {
    if (!this.activeAnswer) {
      this.addChild(new AnswerBoxComponent(text));
      return;
    }
    this.activeAnswer.setText(text);
    this.activeAnswer = null;
  }

  addContextCleared(clearedCount: number, keptCount: number) {
    this.addChild(
      new Text(
        `${theme.muted(
          `⏺ Context threshold reached - cleared ${clearedCount} old tool result${clearedCount !== 1 ? 's' : ''}, kept ${keptCount} most recent`,
        )}`,
        0,
        0,
      ),
    );
  }

  addPerformanceStats(duration: number, tokenUsage?: TokenUsage, tokensPerSecond?: number) {
    const parts = [formatDuration(duration)];
    if (tokenUsage && tokenUsage.totalTokens > 20_000) {
      parts.push(`${tokenUsage.totalTokens.toLocaleString()} tokens`);
      if (tokensPerSecond !== undefined) {
        parts.push(`(${tokensPerSecond.toFixed(1)} tok/s)`);
      }
    }
    this.addChild(new Spacer(1));
    this.addChild(new Text(`${theme.muted('✻ ')}${theme.muted(parts.join(' · '))}`, 0, 0));
  }

  setToolSources(toolCallId: string, entries: ToolSourceEntry[]) {
    const existing = this.toolById.get(toolCallId);
    if (!existing?.setSources) {
      return;
    }
    existing.setSources(entries);
    if (existing.hasSources?.()) {
      this.lastSourceComponent = existing;
    }
  }

  toggleLastToolSources(): boolean {
    if (!this.lastSourceComponent?.toggleSources) {
      return false;
    }
    return this.lastSourceComponent.toggleSources() ?? false;
  }

  addSourcesTrace(entries: SourceTraceEntry[]) {
    if (entries.length === 0) {
      return;
    }

    const grouped = new Map<string, { entry: SourceTraceEntry; count: number }>();
    for (const entry of entries) {
      const key = `${entry.tool}:${entry.reason}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(key, { entry, count: 1 });
      }
    }

    this.addChild(new Spacer(1));
    this.addChild(new Text(`${theme.muted('✻ ')}${theme.primary('Sources used')}`, 0, 0));
    for (const { entry, count } of grouped.values()) {
      const suffix = count > 1 ? theme.muted(` ×${count}`) : '';
      this.addChild(
        new Text(
          `${theme.muted('  - ')}${entry.label}${suffix}${theme.muted(' · ')}${theme.muted(entry.reason)}`,
          0,
          0,
        ),
      );
    }
  }
}
