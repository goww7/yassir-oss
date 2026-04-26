import { useState, useEffect } from 'react';
import { formatToolPhase, formatToolName } from '../utils/tool-phase';

const THINKING_VERBS = ['Thinking', 'Reasoning', 'Considering', 'Reflecting', 'Processing'];

function pickVerb(seed: number): string {
  return THINKING_VERBS[seed % THINKING_VERBS.length] ?? 'Thinking';
}

function ThinkingDots() {
  return (
    <span className="thinking-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

interface Props {
  status: 'thinking' | 'tool' | 'approval';
  toolName?: string;
  progressMessage?: string;
  thinkingLabel?: string;
  startTime: number;
}

export function WorkingIndicator({ status, toolName, progressMessage, thinkingLabel, startTime }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 250);
    return () => clearInterval(timer);
  }, [startTime]);

  const elapsedStr = elapsed < 1000 ? `${Math.round(elapsed)}ms` : `${(elapsed / 1000).toFixed(1)}s`;
  const phaseFrame = Math.floor(elapsed / 2200);

  if (status === 'approval') {
    return (
      <div className="working-indicator" role="status" aria-live="polite">
        <span className="spinner">✻</span>
        Waiting for approval · {elapsedStr} (esc to interrupt)
      </div>
    );
  }

  if (status === 'tool' && toolName) {
    const phase = formatToolPhase(toolName, `${toolName}:${phaseFrame}`);
    const label = progressMessage ?? formatToolName(toolName);
    return (
      <div className="working-indicator" role="status" aria-live="polite">
        <span className="spinner">✻</span>
        {phase} · {label} · {elapsedStr}
        <ThinkingDots />
      </div>
    );
  }

  // Thinking
  const verb = pickVerb(phaseFrame);
  const label = thinkingLabel ? ` · ${thinkingLabel}` : '';
  return (
    <div className="working-indicator" role="status" aria-live="polite">
      <span className="spinner">✻</span>
      {verb}{label} · {elapsedStr}
      <ThinkingDots />
    </div>
  );
}
