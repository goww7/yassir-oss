import { useState, useCallback } from 'react';

interface SessionMeta {
  id: string;
  label: string;
  messageCount: number;
}

let tabCounter = 1;

function createSession(): SessionMeta {
  const id = crypto.randomUUID();
  return { id, label: `Tab ${tabCounter++}`, messageCount: 0 };
}

export function useSessions() {
  const [sessions, setSessions] = useState<SessionMeta[]>(() => [createSession()]);
  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0].id);

  const addSession = useCallback(() => {
    const session = createSession();
    setSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);
    return session.id;
  }, []);

  const removeSession = useCallback((id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const fresh = createSession();
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      return filtered;
    });
    setActiveSessionId((current) => {
      if (current === id) {
        return sessions.find((s) => s.id !== id)?.id ?? sessions[0].id;
      }
      return current;
    });
  }, [sessions]);

  const updateMessageCount = useCallback((id: string, count: number) => {
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, messageCount: count } : s));
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  return { sessions, activeSessionId, addSession, removeSession, selectSession, updateMessageCount };
}
