import { useState, useEffect } from 'react';

interface KeyEntry {
  envVar: string;
  label: string;
  group: string;
  configured: boolean;
  masked: string | null;
  dashboardUrl?: string;
  upgradeUrl?: string;
  helperText?: string;
}

interface Props {
  onClose: () => void;
  onMessage: (msg: string) => void;
}

export function ApiKeysPanel({ onClose, onMessage }: Props) {
  const [groups, setGroups] = useState<Record<string, KeyEntry[]>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');

  const refresh = async () => {
    const res = await fetch('/api/keys');
    const data = await res.json();
    setGroups(data.groups ?? {});
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (editing) setEditing(null); else onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, editing]);

  const handleSave = async (envVar: string) => {
    if (!inputValue.trim()) return;
    const res = await fetch(`/api/keys/${envVar}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: inputValue.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onMessage(data.error ? `Could not save key: ${data.error}` : 'Could not save key');
      return;
    }
    setEditing(null);
    setInputValue('');
    onMessage('API key saved');
    refresh();
  };

  const handleRemove = async (envVar: string) => {
    const res = await fetch(`/api/keys/${envVar}`, { method: 'DELETE' });
    onMessage(res.ok ? 'API key removed' : 'Could not remove key');
    refresh();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="API Keys">
      <div className="keys-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">API Keys</div>
        <div className="keys-subtitle">Add only the keys you need. Yassir saves them to .env and uses them immediately.</div>
        <div className="separator" aria-hidden="true" />

        <div className="keys-content">
          {Object.entries(groups).map(([group, entries]) => (
            <div key={group} className="keys-group">
              <div className="keys-group-title">{group}</div>
              {entries.map((entry) => (
                <div key={entry.envVar} className="keys-entry">
                  <div className="keys-row">
                    <div className="keys-row-left">
                      <span className={`keys-status ${entry.configured ? 'configured' : 'missing'}`}>
                        {entry.configured ? '\u2713' : '\u25CB'}
                      </span>
                      <span className="keys-label">{entry.label}</span>
                      {entry.masked && <span className="keys-masked">{entry.masked}</span>}
                    </div>
                    <div className="keys-row-right">
                      {editing === entry.envVar ? (
                        <form className="keys-edit-form" onSubmit={(e) => { e.preventDefault(); handleSave(entry.envVar); }}>
                          <input
                            type="password"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder={`Paste ${entry.label} key...`}
                            className="keys-input"
                            autoFocus
                          />
                          <button type="submit" className="keys-save-btn">Save</button>
                          <button type="button" className="keys-cancel-btn" onClick={() => setEditing(null)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            className="keys-edit-btn"
                            onClick={() => { setEditing(entry.envVar); setInputValue(''); }}
                          >
                            {entry.configured ? 'Update' : 'Add'}
                          </button>
                          {entry.configured && (
                            <button className="keys-remove-btn" onClick={() => handleRemove(entry.envVar)}>Remove</button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {(entry.helperText || entry.dashboardUrl || entry.upgradeUrl) && (
                    <div className="keys-helper-row">
                      <span className="keys-helper-text">{entry.helperText}</span>
                      <div className="keys-helper-actions">
                        {entry.dashboardUrl && (
                          <a className="keys-link-btn" href={entry.dashboardUrl} target="_blank" rel="noopener noreferrer">
                            Dashboard
                          </a>
                        )}
                        {entry.upgradeUrl && (
                          <a className="keys-link-btn keys-link-btn-primary" href={entry.upgradeUrl} target="_blank" rel="noopener noreferrer">
                            Account
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="separator" aria-hidden="true" />
        <div className="modal-footer">
          <span />
          <span className="modal-hint">Esc to close</span>
        </div>
      </div>
    </div>
  );
}
