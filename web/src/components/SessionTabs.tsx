interface Session {
  id: string;
  label: string;
  messageCount: number;
}

interface Props {
  sessions: Session[];
  activeSessionId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
}

export function SessionTabs({ sessions, activeSessionId, onSelect, onNew, onClose }: Props) {
  return (
    <div className="session-tabs" role="tablist" aria-label="Chat sessions">
      {sessions.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={s.id === activeSessionId}
          className={`session-tab ${s.id === activeSessionId ? 'active' : ''}`}
          onClick={() => onSelect(s.id)}
        >
          <span className="tab-label">{s.label}</span>
          {s.messageCount > 0 && <span className="tab-count">{s.messageCount}</span>}
          {sessions.length > 1 && (
            <span
              role="button"
              tabIndex={0}
              className="tab-close"
              aria-label={`Close ${s.label}`}
              onClick={(e) => { e.stopPropagation(); onClose(s.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onClose(s.id); } }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          )}
        </button>
      ))}
      <button className="session-tab-new" onClick={onNew} aria-label="New session">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
