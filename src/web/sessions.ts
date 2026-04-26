import { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';
import type { ApprovalDecision } from '../agent/types.js';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 50;

export interface WebSession {
  id: string;
  history: InMemoryChatHistory;
  sessionApprovedTools: Set<string>;
  pendingApproval: {
    resolve: (decision: ApprovalDecision) => void;
    tool: string;
    args: Record<string, unknown>;
  } | null;
  abortController: AbortController | null;
  lastActivity: number;
}

const sessions = new Map<string, WebSession>();

function evictStale(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      session.abortController?.abort();
      sessions.delete(id);
    }
  }
}

export function getOrCreateSession(sessionId: string): WebSession {
  evictStale();

  let session = sessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now();
    return session;
  }

  // Enforce max sessions
  if (sessions.size >= MAX_SESSIONS) {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [id, s] of sessions) {
      if (s.lastActivity < oldestTime) {
        oldestTime = s.lastActivity;
        oldest = id;
      }
    }
    if (oldest) {
      sessions.get(oldest)?.abortController?.abort();
      sessions.delete(oldest);
    }
  }

  session = {
    id: sessionId,
    history: new InMemoryChatHistory(),
    sessionApprovedTools: new Set(),
    pendingApproval: null,
    abortController: null,
    lastActivity: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): WebSession | undefined {
  return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.abortController?.abort();
    sessions.delete(sessionId);
  }
}
