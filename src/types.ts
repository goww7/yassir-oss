import type { DisplayEvent, TokenUsage } from './agent/types.js';
import type { GuidedQaRunContext } from './controllers/guided-qa-controller.js';

export type WorkingState =
  | { status: 'idle' }
  | { status: 'thinking'; label?: string }
  | { status: 'tool'; toolName: string; progressMessage?: string }
  | { status: 'approval'; toolName: string };

export type HistoryItemStatus = 'processing' | 'awaiting_clarification' | 'complete' | 'error' | 'interrupted';

export interface HistoryItem {
  id: string;
  query: string;
  events: DisplayEvent[];
  answer: string;
  clarificationContext?: Omit<GuidedQaRunContext, 'enrichedQuery'>;
  status: HistoryItemStatus;
  historySaved?: boolean;
  activeToolId?: string;
  startTime?: number;
  duration?: number;
  tokenUsage?: TokenUsage;
  tokensPerSecond?: number;
}
