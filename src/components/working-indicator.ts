import { Container, Loader, type TUI } from '@mariozechner/pi-tui';
import type { WorkingState } from '../types.js';
import { THINKING_VERBS, getRandomThinkingVerb } from '../utils/thinking-verbs.js';
import { theme } from '../theme.js';
import { formatToolName, formatToolPhase } from './tool-event.js';

function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function pickVariant(options: readonly string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return options[hash % options.length] ?? options[0] ?? '';
}

function animateDots(frame: number): string {
  return ['.', '..', '...'][frame % 3] ?? '...';
}

function compactLabel(value: string, maxLength = 72): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (!singleLine) {
    return '';
  }
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  const lastSpace = singleLine.lastIndexOf(' ', maxLength);
  if (lastSpace > maxLength * 0.5) {
    return `${singleLine.slice(0, lastSpace)}...`;
  }
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

function extractProgressLabel(message?: string): string | null {
  if (!message) {
    return null;
  }
  const normalized = compactLabel(message, 68);
  return normalized || null;
}

export class WorkingIndicatorComponent extends Container {
  private readonly tui: TUI;
  private loader: Loader | null = null;
  private state: WorkingState = { status: 'idle' };
  private thinkingVerb = getRandomThinkingVerb();
  private prevStatus: WorkingState['status'] = 'idle';
  private busySince: number | null = null;
  private refreshTimer: Timer | null = null;
  private frame = 0;

  constructor(tui: TUI) {
    super();
    this.tui = tui;
    this.renderIdle();
  }

  setState(state: WorkingState) {
    const isThinking =
      state.status === 'thinking' || state.status === 'tool' || state.status === 'approval';
    const wasThinking =
      this.prevStatus === 'thinking' ||
      this.prevStatus === 'tool' ||
      this.prevStatus === 'approval';
    if (isThinking && !wasThinking) {
      this.thinkingVerb = getRandomThinkingVerb();
      this.busySince = Date.now();
    }
    this.prevStatus = state.status;
    this.state = state;
    if (state.status === 'idle') {
      this.stopLoader();
      this.stopRefreshTimer();
      this.busySince = null;
      this.renderIdle();
      return;
    }
    this.renderBusy();
    this.ensureRefreshTimer();
  }

  dispose() {
    this.stopLoader();
    this.stopRefreshTimer();
  }

  private renderIdle() {
    this.clear();
  }

  private renderBusy() {
    this.clear();
    this.ensureLoader();
    this.updateMessage();
  }

  private ensureLoader() {
    if (this.loader) {
      this.addChild(this.loader);
      return;
    }
    this.loader = new Loader(
      this.tui,
      (spinner) => theme.primary(spinner),
      (text) => theme.primary(text),
      '',
    );
    this.addChild(this.loader);
  }

  private stopLoader() {
    if (!this.loader) {
      return;
    }
    this.loader.stop();
    this.loader = null;
  }

  private updateMessage() {
    if (!this.loader || this.state.status === 'idle') {
      return;
    }
    this.frame += 1;
    const elapsedMs = this.busySince ? Date.now() - this.busySince : 0;
    const phaseFrame = Math.floor(elapsedMs / 2200);
    const dotFrame = Math.floor(this.frame / 3);
    const elapsed = this.busySince ? ` · ${formatElapsed(Date.now() - this.busySince)}` : '';
    if (this.state.status === 'approval') {
      const approvalLabel = pickVariant(
        ['Waiting for approval', 'Awaiting approval', 'Pending approval'],
        `${this.state.toolName}:${phaseFrame}`,
      );
      this.loader.setMessage(`${approvalLabel}${elapsed} (esc to interrupt)`);
      return;
    }
    if (this.state.status === 'tool') {
      const phaseVerb = formatToolPhase(this.state.toolName, `${this.state.toolName}:${phaseFrame}`);
      const progressLabel = extractProgressLabel(this.state.progressMessage);
      this.loader.setMessage(
        `${phaseVerb} · ${progressLabel ?? formatToolName(this.state.toolName)}${elapsed} (esc to interrupt)`,
      );
      return;
    }
    const thinkingVerb = pickVariant(
      [this.thinkingVerb, THINKING_VERBS[(phaseFrame + 7) % THINKING_VERBS.length] ?? this.thinkingVerb, THINKING_VERBS[(phaseFrame + 19) % THINKING_VERBS.length] ?? this.thinkingVerb],
      `${this.thinkingVerb}:${phaseFrame}`,
    );
    const liveLabel = this.state.label ? extractProgressLabel(this.state.label) : null;
    this.loader.setMessage(
      liveLabel
        ? `${thinkingVerb} · ${liveLabel}${elapsed} (esc to interrupt)`
        : `${thinkingVerb}${animateDots(dotFrame)}${elapsed} (esc to interrupt)`,
    );
  }

  private ensureRefreshTimer() {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setInterval(() => {
      this.updateMessage();
      this.tui.requestRender();
    }, 250);
  }

  private stopRefreshTimer() {
    if (!this.refreshTimer) {
      return;
    }
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }
}
