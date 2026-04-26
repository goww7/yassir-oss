import Markdown from 'react-markdown';
import { ToolEvent } from './ToolEvent';
import { WorkingIndicator } from './WorkingIndicator';
import { ClarificationPrompt } from './ClarificationPrompt';
import type { ChatMessage } from '../types';

const ALL_EVENT_TYPES = [
  'tool_start', 'tool_end', 'tool_error', 'tool_progress', 'tool_limit',
  'thinking', 'tool_approval', 'tool_denied',
  'context_cleared', 'memory_recalled', 'memory_flush',
];

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
  onClarificationAnswer?: (answer: string) => void;
}

export function MessageBubble({ message, isStreaming, onClarificationAnswer }: Props) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="user-query">
        <span className="user-query-prompt">❯</span>
        <span className="user-query-text">{message.content}</span>
      </div>
    );
  }

  const displayEvents = message.events.filter((e) => ALL_EVENT_TYPES.includes(e.type));
  const doneEvent = message.events.find((e) => e.type === 'done');
  const clarification = message.events.find((e) => e.type === 'clarification_needed');
  const totalTime = doneEvent ? (doneEvent.totalTime as number) : null;
  const tokensPerSec = doneEvent ? (doneEvent.tokensPerSecond as number) : null;
  const tokenUsage = doneEvent ? (doneEvent as { tokenUsage?: { totalTokens: number } }).tokenUsage : null;

  // Determine working state from events
  const lastEvent = message.events[message.events.length - 1];
  const stillStreaming = !doneEvent && !clarification;
  let workingStatus: 'thinking' | 'tool' | 'approval' | null = null;
  let workingToolName: string | undefined;
  let workingProgress: string | undefined;
  let workingLabel: string | undefined;

  if (stillStreaming && lastEvent) {
    if (lastEvent.type === 'tool_start') {
      workingStatus = 'tool';
      workingToolName = lastEvent.tool as string;
    } else if (lastEvent.type === 'tool_progress') {
      workingStatus = 'tool';
      workingToolName = lastEvent.tool as string;
      workingProgress = lastEvent.message as string;
    } else if (lastEvent.type === 'tool_approval_request') {
      workingStatus = 'approval';
      workingToolName = lastEvent.tool as string;
    } else if (lastEvent.type === 'thinking') {
      workingStatus = 'thinking';
      workingLabel = lastEvent.message as string;
    } else if (lastEvent.type !== 'done' && lastEvent.type !== 'error') {
      workingStatus = 'thinking';
    }
  }

  // Step counter
  let stepCount = 0;

  return (
    <div className="assistant-block">
      {/* Tool events */}
      {displayEvents.map((event, i) => {
        if (event.type === 'tool_start') stepCount++;
        return <ToolEvent key={i} event={event} stepNum={event.type === 'tool_start' ? stepCount : undefined} />;
      })}

      {/* Working indicator */}
      {stillStreaming && workingStatus && (
        <WorkingIndicator
          status={workingStatus}
          toolName={workingToolName}
          progressMessage={workingProgress}
          thinkingLabel={workingLabel}
          startTime={message.timestamp}
        />
      )}

      {/* Clarification */}
      {clarification && onClarificationAnswer && (
        <ClarificationPrompt
          question={clarification.question as string}
          mode={(clarification.mode as 'inline' | 'single_select') ?? 'inline'}
          options={clarification.options as Array<{ value: string; label: string; description?: string }> | undefined}
          onAnswer={onClarificationAnswer}
        />
      )}

      {/* Answer with streaming cursor */}
      {message.content && (
        <>
          <div className="assistant-answer">
            <span className="answer-marker" aria-hidden="true">⏺</span>
            <Markdown>{message.content}</Markdown>
            {isStreaming && <span className="streaming-cursor" aria-hidden="true" />}
          </div>
          {totalTime != null && (
            <div className="stats-line">
              <span className="marker">✻</span>
              {totalTime.toFixed(0)}s
              {tokenUsage && ` · ${tokenUsage.totalTokens.toLocaleString()} tokens`}
              {tokensPerSec && ` · (${tokensPerSec.toFixed(1)} tok/s)`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
