import { useState, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useInputHistory } from '../hooks/useInputHistory';
import { SlashAutocomplete } from './SlashAutocomplete';

interface Props {
  onSend: (query: string) => void;
  onAbort?: () => void;
  disabled: boolean;
}

export function InputBar({ onSend, onAbort, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useInputHistory();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || disabled) return;
    history.save(trimmed);
    setShowAutocomplete(false);
    onSend(trimmed);
    setQuery('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' && !showAutocomplete) {
      e.preventDefault();
      const prev = history.navigateUp(query);
      if (prev !== null) setQuery(prev);
      return;
    }
    if (e.key === 'ArrowDown' && !showAutocomplete) {
      e.preventDefault();
      const next = history.navigateDown();
      if (next !== null) setQuery(next);
      return;
    }
    if (e.key === 'Escape') {
      if (showAutocomplete) {
        setShowAutocomplete(false);
      } else if (onAbort) {
        onAbort();
      }
      return;
    }
    // Close autocomplete on non-slash input
    if (e.key === 'Backspace' && query === '/') {
      setShowAutocomplete(false);
    }
  };

  const handleChange = (value: string) => {
    setQuery(value);
    history.reset();
    if (value.startsWith('/') && value.length > 0 && !value.includes(' ')) {
      setShowAutocomplete(true);
    } else {
      setShowAutocomplete(false);
    }
  };

  const handleAutocompleteSelect = (cmd: string) => {
    setQuery(cmd + ' ');
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  return (
    <div className="input-bar-container">
      {showAutocomplete && (
        <SlashAutocomplete
          filter={query}
          onSelect={handleAutocompleteSelect}
          onClose={() => setShowAutocomplete(false)}
        />
      )}
      <form className="terminal-input-form" onSubmit={handleSubmit}>
        <span className="input-prompt">❯</span>
        <input
          ref={inputRef}
          className="terminal-input"
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Waiting...' : 'Type a query or /command...'}
          disabled={disabled}
          autoFocus
          aria-label="Chat input"
        />
        <button
          type="submit"
          className={`send-btn ${query.trim() ? 'has-text' : ''}`}
          disabled={disabled || !query.trim()}
          aria-label="Send"
          tabIndex={-1}
        >
          ↵
        </button>
      </form>
    </div>
  );
}
