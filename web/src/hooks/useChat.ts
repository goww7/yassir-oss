import { useReducer, useCallback } from 'react';
import { streamChat, sendApproval, abortChat } from '../api/client';
import type { AgentEvent, ChatMessage, ApprovalDecision } from '../types';

type Status = 'idle' | 'streaming' | 'awaiting_approval' | 'awaiting_clarification' | 'error';

interface ChatState {
  messages: ChatMessage[];
  status: Status;
  pendingApproval: { tool: string; args: Record<string, unknown> } | null;
  error: string | null;
}

type ChatAction =
  | { type: 'SEND_QUERY'; query: string }
  | { type: 'ADD_LOCAL_ANSWER'; content: string }
  | { type: 'SSE_EVENT'; event: AgentEvent }
  | { type: 'STREAM_END' }
  | { type: 'APPROVAL_SENT' }
  | { type: 'ERROR'; error: string };

let msgId = 0;
function nextId(): string { return `msg-${++msgId}`; }

function reducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SEND_QUERY':
      return {
        ...state,
        status: 'streaming',
        error: null,
        messages: [
          ...state.messages,
          { id: nextId(), role: 'user', content: action.query, events: [], timestamp: Date.now() },
          { id: nextId(), role: 'assistant', content: '', events: [], timestamp: Date.now() },
        ],
      };

    case 'ADD_LOCAL_ANSWER':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: nextId(), role: 'assistant', content: action.content, events: [
            { type: 'done', answer: action.content, iterations: 0, totalTime: 0, toolCalls: [] }
          ], timestamp: Date.now() },
        ],
      };

    case 'SSE_EVENT': {
      const event = action.event;
      const messages = [...state.messages];
      const last = messages[messages.length - 1];

      if (last?.role === 'assistant') {
        const updated = { ...last, events: [...last.events, event] };
        if (event.type === 'done') updated.content = (event as { answer: string }).answer;

        if (event.type === 'tool_approval_request') {
          messages[messages.length - 1] = updated;
          return { ...state, messages, status: 'awaiting_approval',
            pendingApproval: { tool: (event as { tool: string }).tool, args: (event as { args: Record<string, unknown> }).args } };
        }

        if (event.type === 'clarification_needed') {
          messages[messages.length - 1] = updated;
          return { ...state, messages, status: 'awaiting_clarification', pendingApproval: null };
        }

        messages[messages.length - 1] = updated;
      }
      return { ...state, messages };
    }

    case 'STREAM_END':
      return { ...state, status: 'idle', pendingApproval: null };

    case 'APPROVAL_SENT':
      return { ...state, status: 'streaming', pendingApproval: null };

    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
  }
}

export function useChat(sessionId: string) {
  const [state, dispatch] = useReducer(reducer, {
    messages: [],
    status: 'idle',
    pendingApproval: null,
    error: null,
  });

  const send = useCallback(
    async (query: string) => {
      dispatch({ type: 'SEND_QUERY', query });

      // Retry once on network failure (Safari SSE race condition)
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          for await (const event of streamChat({ sessionId, query })) {
            dispatch({ type: 'SSE_EVENT', event });
            if (event.type === 'done' || event.type === 'error') break;
          }
          break; // success — exit retry loop
        } catch (err: unknown) {
          if (attempt === 0) {
            // First failure — retry after brief delay
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : 'Connection lost' });
        }
      }

      dispatch({ type: 'STREAM_END' });
    },
    [sessionId],
  );

  const addLocalAnswer = useCallback((content: string) => {
    dispatch({ type: 'ADD_LOCAL_ANSWER', content });
  }, []);

  const approve = useCallback(
    async (decision: ApprovalDecision) => {
      dispatch({ type: 'APPROVAL_SENT' });
      await sendApproval(sessionId, decision);
    },
    [sessionId],
  );

  const abort = useCallback(() => {
    abortChat(sessionId);
  }, [sessionId]);

  return { ...state, send, addLocalAnswer, approve, abort };
}
