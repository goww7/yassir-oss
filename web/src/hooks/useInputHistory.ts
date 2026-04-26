import { useRef, useCallback } from 'react';

export function useInputHistory() {
  const history = useRef<string[]>([]);
  const index = useRef(-1);
  const draft = useRef('');

  const save = useCallback((query: string) => {
    if (query.trim() && (history.current.length === 0 || history.current[history.current.length - 1] !== query)) {
      history.current.push(query);
    }
    index.current = -1;
    draft.current = '';
  }, []);

  const navigateUp = useCallback((currentValue: string): string | null => {
    if (history.current.length === 0) return null;
    if (index.current === -1) {
      draft.current = currentValue;
      index.current = history.current.length - 1;
    } else if (index.current > 0) {
      index.current -= 1;
    } else {
      return null;
    }
    return history.current[index.current] ?? null;
  }, []);

  const navigateDown = useCallback((): string | null => {
    if (index.current === -1) return null;
    if (index.current < history.current.length - 1) {
      index.current += 1;
      return history.current[index.current] ?? null;
    }
    // Back to draft
    index.current = -1;
    return draft.current;
  }, []);

  const reset = useCallback(() => {
    index.current = -1;
    draft.current = '';
  }, []);

  return { save, navigateUp, navigateDown, reset };
}
